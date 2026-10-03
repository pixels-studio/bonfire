<script lang="ts">
  import { onMount } from 'svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { APPROVAL_MODES } from '$lib/models';
  import { playCompletionSound } from '$lib/sounds';
  import { preferences } from '$lib/stores/preferences.svelte';
  import { isMac } from '$lib/utils';
  import type { CodexPersonality, FollowUpMode } from '$shared/contracts';
  import {
    CAFFEINATE_BATTERY_FLOOR,
    LONG_TEXT_THRESHOLD,
  } from '$shared/domain';
  import AccentSlider from './accent-slider.svelte';
  import ConnectionSettings from './connection-settings.svelte';
  import GithubSettings from './github-settings.svelte';
  import ModelChoiceSelect from './model-choice-select.svelte';
  import OptionSelect from './option-select.svelte';
  import ProviderSetting from './provider-setting.svelte';
  import Setting from './setting.svelte';
  import SettingsSection from './settings-section.svelte';

  const FOLLOW_UPS: { value: FollowUpMode; label: string }[] = [
    { value: 'queue', label: 'Queue' },
    { value: 'steer', label: 'Steer' },
  ];
  const PERSONALITIES: { value: CodexPersonality; label: string }[] = [
    { value: 'default', label: 'Default' },
    { value: 'friendly', label: 'Friendly' },
    { value: 'pragmatic', label: 'Pragmatic' },
    { value: 'none', label: 'None' },
  ];
  /** Claude's built-in styles, shown until it reports the full list. */
  const BUILT_IN_OUTPUT_STYLES = ['default', 'Explanatory', 'Learning'];

  const modifierKey = isMac() ? '⌘' : 'Ctrl';
  const current = $derived(preferences.current);
  let outputStyles = $state(BUILT_IN_OUTPUT_STYLES);
  const outputStyleOptions = $derived(
    outputStyles.map((style) => ({
      value: style,
      label: style === 'default' ? 'Default' : style,
    })),
  );

  function setCompletionSound(completionSound: boolean) {
    // Turning it on plays it, so the user knows what to listen for.
    if (completionSound) playCompletionSound();
    void preferences.update({ completionSound });
  }

  onMount(() => {
    if (!current.providers.claude) return;
    window.bonfire.providers
      .outputStyles()
      .then((styles) => {
        if (styles.length) outputStyles = styles;
      })
      .catch(() => {});
  });
</script>

{#snippet followUpDescription()}
  For messages sent mid-run. <kbd class="font-sans">{modifierKey} Enter</kbd>
  does the opposite once
{/snippet}

<div class="divide-y divide-border">
  <SettingsSection title="General" icon="section-general">
    <Setting
      title="Accent color"
      description="Tints buttons, highlights, and surfaces"
    >
      {#snippet control(props)}
        <AccentSlider
          {...props}
          hue={current.accentHue}
          oncommit={(accentHue) => preferences.update({ accentHue })}
        />
      {/snippet}
    </Setting>
    <Setting
      title="Session notifications"
      description="Alert when a pane finishes, fails, or needs you"
      inline
    >
      {#snippet control(props)}
        <Switch
          {...props}
          checked={current.notifications}
          onCheckedChange={(notifications) =>
            preferences.update({ notifications })}
        />
      {/snippet}
    </Setting>
    <Setting
      title="Completion sound"
      description="Chime when an agent finishes"
      inline
    >
      {#snippet control(props)}
        <Switch
          {...props}
          checked={current.completionSound}
          onCheckedChange={setCompletionSound}
        />
      {/snippet}
    </Setting>
    <Setting
      title="Caffeinate while agents are running"
      description={`Stops below ${CAFFEINATE_BATTERY_FLOOR}% battery`}
      inline
    >
      {#snippet control(props)}
        <Switch
          {...props}
          checked={current.caffeinate}
          onCheckedChange={(caffeinate) => preferences.update({ caffeinate })}
        />
      {/snippet}
    </Setting>
  </SettingsSection>

  <SettingsSection title="Agents" icon="section-agents">
    <Setting title="Model" description="Starting model for new panes">
      {#snippet control(props)}
        <ModelChoiceSelect
          {...props}
          allowLastUsed
          value={current.defaultModel}
          onchange={(defaultModel) => preferences.update({ defaultModel })}
        />
      {/snippet}
    </Setting>
    <Setting title="Permissions" description="What agents may do unasked">
      {#snippet control(props)}
        <OptionSelect
          {...props}
          options={APPROVAL_MODES}
          value={current.approvals}
          onchange={(approvals) => preferences.update({ approvals })}
        />
      {/snippet}
    </Setting>
    <Setting title="Follow-up behavior" description={followUpDescription}>
      {#snippet control(props)}
        <OptionSelect
          {...props}
          options={FOLLOW_UPS}
          value={current.followUp}
          onchange={(followUp) => preferences.update({ followUp })}
        />
      {/snippet}
    </Setting>
    <Setting
      title="Text generation model"
      description="Writes pane titles and other short text"
    >
      {#snippet control(props)}
        <ModelChoiceSelect
          {...props}
          value={current.textModel}
          onchange={(textModel) =>
            textModel && preferences.update({ textModel })}
        />
      {/snippet}
    </Setting>
    <Setting
      title="Auto-convert long text"
      description={`Pastes over ${LONG_TEXT_THRESHOLD.toLocaleString()} characters become attachments`}
      inline
    >
      {#snippet control(props)}
        <Switch
          {...props}
          checked={current.convertLongText}
          onCheckedChange={(convertLongText) =>
            preferences.update({ convertLongText })}
        />
      {/snippet}
    </Setting>
  </SettingsSection>

  <SettingsSection title="Providers" icon="section-providers">
    <ProviderSetting provider="claude" />
    <ProviderSetting provider="codex" />
  </SettingsSection>

  <SettingsSection title="Response style" icon="section-response-style">
    <Setting
      title="Claude output style"
      description="How Claude formats replies"
    >
      {#snippet control(props)}
        <OptionSelect
          {...props}
          options={outputStyleOptions}
          value={current.claudeOutputStyle}
          disabled={!current.providers.claude}
          onchange={(claudeOutputStyle) =>
            preferences.update({ claudeOutputStyle })}
        />
      {/snippet}
    </Setting>
    <Setting
      title="Codex personality"
      description="The tone of Codex's replies"
    >
      {#snippet control(props)}
        <OptionSelect
          {...props}
          options={PERSONALITIES}
          value={current.codexPersonality}
          disabled={!current.providers.codex}
          onchange={(codexPersonality) =>
            preferences.update({ codexPersonality })}
        />
      {/snippet}
    </Setting>
  </SettingsSection>

  <SettingsSection title="GitHub" icon="github">
    <GithubSettings />
  </SettingsSection>

  <ConnectionSettings />
</div>
