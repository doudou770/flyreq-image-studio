import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(
  path.resolve(testDir, '../../../../backend/server.js'),
  'utf8',
);

describe('后端平台品牌配置', () => {
  it('从环境变量读取平台名称、Logo 和图标地址', () => {
    expect(serverSource).toContain('FLYREQ_PLATFORM_NAME');
    expect(serverSource).toContain('FLYREQ_PLATFORM_LOGO_URL');
    expect(serverSource).toContain('FLYREQ_PLATFORM_ICON_URL');
    expect(serverSource).toContain('process.env.APP_VERSION');
    expect(serverSource).toContain('function resolvePlatformBranding(env = getRuntimeEnv())');
  });

  it('将品牌配置下发给页面和动态 PWA Manifest', () => {
    expect(serverSource).toContain('branding: resolvePlatformBranding(env)');
    expect(serverSource).toContain("'/api/flyreq/manifest.webmanifest'");
    expect(serverSource).toContain('buildPlatformManifest(resolvePlatformBranding(getRuntimeEnv()))');
  });
});
