// Dictation for the composer, on macOS's own speech recognizer. Chromium's Web Speech API
// needs Google's speech service, which Electron can't reach, so the app runs this instead.
//
// Writes one JSON object per line to stdout:
//   {"type":"ready"}                  listening
//   {"type":"result","text":"…"}      everything heard so far, revised as recognition firms up
//   {"type":"level","level":0.4}      microphone loudness, 0 to 1
//   {"type":"error","error":"…"}      not-allowed, service-not-allowed, audio-capture, unavailable
//   {"type":"end"}                    done; the process exits right after
// Stops on a "stop" line or when stdin closes.
import AVFoundation
import Darwin
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

let output = DispatchQueue(label: "output")

func emit(_ message: [String: Any]) {
  guard
    let data = try? JSONSerialization.data(withJSONObject: message),
    let line = String(data: data, encoding: .utf8)
  else { return }
  output.sync { print(line) }
}

func finish(error: String? = nil) -> Never {
  if let error { emit(["type": "error", "error": error]) }
  emit(["type": "end"])
  exit(error == nil ? 0 : 1)
}

/// Re-runs this program as its own "responsible" process, so macOS asks for the microphone
/// and speech recognition on behalf of this helper (whose embedded Info.plist explains why)
/// rather than the app that started it. Only used in development, where that app is a bare
/// Electron without the usage descriptions macOS requires.
func runDisclaimed() -> Never {
  typealias SetDisclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32)
    -> Int32
  guard
    let symbol = dlsym(
      UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim")
  else { finish(error: "unavailable") }
  var attributes: posix_spawnattr_t?
  posix_spawnattr_init(&attributes)
  _ = unsafeBitCast(symbol, to: SetDisclaim.self)(&attributes, 1)
  setenv("BONFIRE_DICTATION_DISCLAIMED", "1", 1)
  let path = CommandLine.arguments[0]
  var argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
  var child: pid_t = 0
  guard posix_spawn(&child, path, nil, &attributes, &argv, environ) == 0 else {
    finish(error: "unavailable")
  }
  for signal in [SIGTERM, SIGINT, SIGHUP] {
    let source = DispatchSource.makeSignalSource(signal: signal)
    Darwin.signal(signal, SIG_IGN)
    source.setEventHandler { kill(child, signal) }
    source.resume()
    signalSources.append(source)
  }
  DispatchQueue.global().async {
    var status: Int32 = 0
    while waitpid(child, &status, 0) == -1 && errno == EINTR {}
    exit((status & 0x7f) == 0 ? (status >> 8) & 0xff : 1)
  }
  dispatchMain()
}
var signalSources: [DispatchSourceSignal] = []

func authorize(_ done: @escaping () -> Void) {
  func speech() {
    SFSpeechRecognizer.requestAuthorization { status in
      guard status == .authorized else { finish(error: "service-not-allowed") }
      done()
    }
  }
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: speech()
  case .notDetermined:
    AVCaptureDevice.requestAccess(for: .audio) { granted in
      guard granted else { finish(error: "not-allowed") }
      speech()
    }
  default: finish(error: "not-allowed")
  }
}

final class Listener {
  private let recognizer: SFSpeechRecognizer
  private let engine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  /// Text from earlier recognition tasks; one ends after a long pause and the next carries on.
  private var committed = ""
  private var current = ""
  private var stopping = false
  private let queue = DispatchQueue(label: "listener")

  init(recognizer: SFSpeechRecognizer) {
    self.recognizer = recognizer
  }

  func start() {
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.channelCount > 0, format.sampleRate > 0 else {
      finish(error: "audio-capture")
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.queue.async { self?.request?.append(buffer) }
      guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
      var energy: Float = 0
      for index in 0..<Int(buffer.frameLength) { energy += samples[index] * samples[index] }
      let rms = (energy / Float(buffer.frameLength)).squareRoot()
      emit(["type": "level", "level": min(1, Double(rms) * 15.5)])
    }
    queue.sync { begin() }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      finish(error: "audio-capture")
    }
    emit(["type": "ready"])
  }

  /// Starts a recognition task; called on `queue`.
  private func begin() {
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.addsPunctuation = true
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    self.request = request
    current = ""
    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      self?.queue.async { self?.handle(result: result, error: error, request: request) }
    }
  }

  private func handle(
    result: SFSpeechRecognitionResult?, error: Error?, request: SFSpeechAudioBufferRecognitionRequest
  ) {
    guard request === self.request else { return }
    if let result {
      current = result.bestTranscription.formattedString
      emit(["type": "result", "text": text()])
    }
    guard result?.isFinal == true || error != nil else { return }
    if stopping { finish() }
    // The recognizer gave up on this stretch, such as after a long silence; keep listening.
    if !current.isEmpty { committed = text() }
    begin()
  }

  private func text() -> String {
    [committed, current].filter { !$0.isEmpty }.joined(separator: " ")
  }

  func stop() {
    queue.async {
      guard !self.stopping else { return }
      self.stopping = true
      self.engine.inputNode.removeTap(onBus: 0)
      self.engine.stop()
      self.request?.endAudio()
      emit(["type": "level", "level": 0])
    }
    // The last words usually firm up quickly; don't wait on them forever.
    DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { finish() }
  }
}

if ProcessInfo.processInfo.environment["BONFIRE_DICTATION_DISCLAIM"] == "1"
  && ProcessInfo.processInfo.environment["BONFIRE_DICTATION_DISCLAIMED"] == nil
{
  runDisclaimed()
}

let language = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
guard
  let recognizer = SFSpeechRecognizer(
    locale: language.isEmpty ? Locale.current : Locale(identifier: language))
    ?? SFSpeechRecognizer()
else { finish(error: "unavailable") }

var listener: Listener?

authorize {
  DispatchQueue.main.async {
    guard recognizer.isAvailable else { finish(error: "unavailable") }
    listener = Listener(recognizer: recognizer)
    listener?.start()
  }
}

Thread.detachNewThread {
  while let line = readLine(), line.trimmingCharacters(in: .whitespaces) != "stop" {}
  DispatchQueue.main.async {
    guard let listener else { finish() }
    listener.stop()
  }
}

dispatchMain()
