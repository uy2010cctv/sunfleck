/** Simplified Chinese recorder-model settings copy. */
export const zh = {
  nav: '录音与语音模型',
  title: 'ASR 与说话人模型',
  intro: '选择录音转写和说话人识别的运行位置。保存只更新配置；启动后读回真实健康状态。',
  status: '运行状态',
  running: '运行中', starting: '启动中', stopped: '已停止', error: '异常',
  ready: '已就绪', notReady: '未就绪', configured: '凭据已配置', missingCredential: '凭据未配置',
  asr: 'ASR 转写', cam: 'CAM 说话人', enabled: '启用说话人识别',
  local: '本地模型', online: '在线模型', model: '模型', endpoint: '在线端点', credentialRef: 'Credential 引用', threshold: '本人匹配阈值',
  localAsrHint: '在 Mac 上运行 FunASR，音频不离开本地环境。',
  onlineAsrHint: '把音频发送到 HTTPS 转写端点，密钥由 DSH Credential 管理。',
  localCamHint: '在 Mac 上运行 CAM++ 分离与本人声纹匹配。',
  onlineCamHint: '调用受信任的 HTTPS 说话人服务。',
  save: '保存配置', start: '启动 / 重载', refresh: '刷新状态', saving: '正在保存…', startingAction: '正在启动…', saved: '配置已保存',
  loadError: '无法读取录音模型状态。', actionError: '操作失败，已保留当前配置。',
} as const
export type RecorderSettingsKey = keyof typeof zh
/** English recorder-model settings copy. */
export const en: Record<RecorderSettingsKey, string> = {
  nav: 'Recording & speech models', title: 'ASR and speaker models',
  intro: 'Choose where transcription and speaker recognition run. Save updates configuration; Start verifies real runtime health.',
  status: 'Runtime status', running: 'Running', starting: 'Starting', stopped: 'Stopped', error: 'Error',
  ready: 'Ready', notReady: 'Not ready', configured: 'Credential configured', missingCredential: 'Credential missing',
  asr: 'ASR transcription', cam: 'CAM speaker model', enabled: 'Enable speaker recognition',
  local: 'Local model', online: 'Online model', model: 'Model', endpoint: 'Online endpoint', credentialRef: 'Credential reference', threshold: 'Owner match threshold',
  localAsrHint: 'Runs FunASR on the Mac so audio stays inside the local environment.',
  onlineAsrHint: 'Sends audio to an HTTPS transcription endpoint using a DSH-managed Credential.',
  localCamHint: 'Runs CAM++ diarization and owner voice matching on the Mac.',
  onlineCamHint: 'Calls a trusted HTTPS speaker service.',
  save: 'Save configuration', start: 'Start / reload', refresh: 'Refresh status', saving: 'Saving…', startingAction: 'Starting…', saved: 'Configuration saved',
  loadError: 'Could not read recorder model status.', actionError: 'The operation failed; the current configuration is preserved.',
}
