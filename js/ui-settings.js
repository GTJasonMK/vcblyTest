export function getMaxUnknownInput() {
  const input = document.getElementById('maxUnknown');
  return parseInt(input?.value, 10) || 20;
}

export function setMaxUnknownInput(value) {
  const input = document.getElementById('maxUnknown');
  if (input) input.value = value;
}

export function getAutoPlayAudioInput() {
  const input = document.getElementById('autoPlayAudio');
  return input ? input.checked : true;
}

export function setAutoPlayAudioInput(value) {
  const input = document.getElementById('autoPlayAudio');
  if (input) input.checked = value !== false;
}

export function getHomeSettingsInput() {
  return {
    maxUnknown: getMaxUnknownInput(),
    autoPlayAudio: getAutoPlayAudioInput(),
  };
}
