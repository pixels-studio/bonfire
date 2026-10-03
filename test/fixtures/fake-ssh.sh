#!/bin/sh
# A stand-in for `ssh` that runs the remote command on this computer, the way sshd
# would: through a shell, with everything after the destination as one command line.
while [ $# -gt 0 ]; do
  case "$1" in
    -o | -p | -i) shift 2 ;;
    -T | -tt) shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
if [ "$1" = unreachable ]; then
  echo "ssh: connect to host unreachable port 22: Connection refused" >&2
  exit 255
fi
shift
# Tests point the remote home somewhere disposable.
[ -n "$BONFIRE_FAKE_SSH_HOME" ] && export HOME="$BONFIRE_FAKE_SSH_HOME"
SHELL=/bin/sh exec /bin/sh -c "$*"
