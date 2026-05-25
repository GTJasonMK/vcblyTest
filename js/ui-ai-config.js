import { askAi } from './ai.js';
import { loadAiConfig, saveAiConfig } from './storage.js';
import { toast } from './ui-common.js';

function readConfigForm() {
  const rawKey = document.getElementById('aiApiKey').value.trim();
  if (rawKey && !/^[\x00-\xFF]*$/.test(rawKey)) {
    toast('API Key 包含非 ASCII 字符，请检查');
    return null;
  }

  return {
    endpoint: document.getElementById('aiEndpoint').value.trim(),
    apiKey: rawKey,
    model: document.getElementById('aiModel').value.trim(),
  };
}

export function toggleAiConfig() {
  const modal = document.getElementById('aiConfigModal');
  if (!modal) return;
  const show = modal.hidden;
  modal.hidden = !show;
  document.body.classList.toggle('modal-open', show);
  if (show) {
    document.getElementById('aiConfigStatus').textContent = '';
    const cfg = loadAiConfig();
    document.getElementById('aiEndpoint').value = cfg.endpoint || '';
    document.getElementById('aiApiKey').value = cfg.apiKey || '';
    document.getElementById('aiModel').value = cfg.model || '';
  }
}

export function saveAiConfigForm() {
  const config = readConfigForm();
  if (!config) return;

  saveAiConfig(config);
  const status = document.getElementById('aiConfigStatus');
  if (status) status.textContent = '配置已保存 ✓';
  toast('AI 配置已保存');
}

export async function testAiConfig() {
  const config = readConfigForm();
  if (!config) return;

  saveAiConfig(config);
  const status = document.getElementById('aiConfigStatus');
  if (status) status.textContent = '测试连接中…';
  toast('正在测试 API 连接…');
  try {
    await askAi('test', {}, 'explain');
    if (status) status.textContent = '连接成功 ✓';
    toast('AI 连接测试成功');
  } catch (e) {
    if (status) status.textContent = '连接失败：' + e.message;
    toast('AI 连接测试失败：' + e.message);
  }
}
