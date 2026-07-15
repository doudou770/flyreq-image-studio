import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDir, '../../../..');
const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');
const releaseWorkflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'release.yml'), 'utf8');
const nextConfig = fs.readFileSync(path.join(repositoryRoot, 'frontend', 'next.config.ts'), 'utf8');
const brandProvider = fs.readFileSync(path.join(repositoryRoot, 'frontend', 'src', 'components', 'BrandProvider.tsx'), 'utf8');
const legacyVersionEnv = ['NEXT', 'PUBLIC', 'APP', 'VERSION'].join('_');

describe('发布版本到 UI 的传递', () => {
  it('将发布工作流计算出的 tag 版本写入 Docker 构建参数和运行环境变量', () => {
    expect(releaseWorkflow).toContain('APP_VERSION=${{ steps.version.outputs.version }}');
    expect(releaseWorkflow).toContain('sha=$(git rev-parse HEAD)');
    expect(releaseWorkflow).toContain('org.opencontainers.image.revision=${{ steps.source.outputs.sha }}');
    expect(dockerfile).toContain('ARG APP_VERSION=0.0.0');
    expect(dockerfile).toContain('APP_VERSION=${APP_VERSION}');
    expect(nextConfig).not.toContain(legacyVersionEnv);
    expect(brandProvider).not.toContain(legacyVersionEnv);
  });
});
