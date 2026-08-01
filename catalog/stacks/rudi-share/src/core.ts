import { access, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export type ProjectType = 'vanilla' | 'vite' | 'react-vite' | 'unsupported'

export interface ProjectPreflight {
  projectPath: string
  projectType: ProjectType
  artifactPath: string
  buildRequired: boolean
  installCommand: string | null
  buildCommand: string | null
  blockers: string[]
  warnings: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function hasStringProperty(value: unknown, key: string): boolean {
  return isRecord(value) && typeof value[key] === 'string'
}

export async function preflightProject(inputPath: string): Promise<ProjectPreflight> {
  if (!isAbsolute(inputPath)) {
    throw new Error('project_path must be an absolute path.')
  }
  const projectPath = await realpath(inputPath)
  if (!(await stat(projectPath)).isDirectory()) {
    throw new Error('project_path must identify a directory.')
  }

  const packagePath = join(projectPath, 'package.json')
  if (!(await exists(packagePath))) {
    const blockers = (await exists(join(projectPath, 'index.html')))
      ? []
      : ['Root index.html is required for a vanilla static app.']
    return {
      projectPath,
      projectType: blockers.length === 0 ? 'vanilla' : 'unsupported',
      artifactPath: projectPath,
      buildRequired: false,
      installCommand: null,
      buildCommand: null,
      blockers,
      warnings: [],
    }
  }

  let packageJson: unknown
  try {
    packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as unknown
  } catch {
    throw new Error('package.json is not valid JSON.')
  }
  if (!isRecord(packageJson)) throw new Error('package.json must contain an object.')

  const dependencies = packageJson.dependencies
  const devDependencies = packageJson.devDependencies
  const scripts = packageJson.scripts
  const hasVite =
    hasStringProperty(dependencies, 'vite') || hasStringProperty(devDependencies, 'vite')
  const hasReact =
    hasStringProperty(dependencies, 'react') || hasStringProperty(devDependencies, 'react')
  const hasBuildScript = hasStringProperty(scripts, 'build')
  const lockfiles = (
    await Promise.all(
      [
        ['npm', 'package-lock.json'],
        ['pnpm', 'pnpm-lock.yaml'],
        ['yarn', 'yarn.lock'],
      ].map(async ([manager, file]) => ({
        manager,
        present: await exists(join(projectPath, file)),
      }))
    )
  ).filter((lockfile) => lockfile.present)
  const blockers: string[] = []

  if (!hasVite) blockers.push('Only vanilla and Vite static projects are supported.')
  if (!hasBuildScript) blockers.push('package.json requires a build script.')
  if (lockfiles.length === 0) blockers.push('A supported lockfile is required.')
  if (lockfiles.length > 1) blockers.push('Multiple package-manager lockfiles are ambiguous.')

  const manager = lockfiles.length === 1 ? lockfiles[0]?.manager : null
  const commands =
    manager === 'npm'
      ? { install: 'npm ci', build: 'npm run build' }
      : manager === 'pnpm'
        ? { install: 'pnpm install --frozen-lockfile', build: 'pnpm run build' }
        : manager === 'yarn'
          ? { install: 'yarn install --frozen-lockfile', build: 'yarn build' }
          : { install: null, build: null }

  return {
    projectPath,
    projectType: hasVite ? (hasReact ? 'react-vite' : 'vite') : 'unsupported',
    artifactPath: join(projectPath, 'dist'),
    buildRequired: true,
    installCommand: commands.install,
    buildCommand: commands.build,
    blockers,
    warnings: [],
  }
}
