import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants, type BigIntStats } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'

const TAR_BLOCK_BYTES = 512
const MAX_TAR_BYTES = 25 * 1024 * 1024
const MAX_FILES = 2_000
const MAX_PATH_BYTES = 240

export class ArtifactPackagingError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_ARTIFACT_PATH'
      | 'UNSUPPORTED_ARTIFACT_ENTRY'
      | 'FORBIDDEN_ARTIFACT_FILE'
      | 'SECRET_DETECTED'
      | 'ARTIFACT_LIMIT_EXCEEDED'
      | 'MISSING_INDEX',
    message: string
  ) {
    super(message)
    this.name = 'ArtifactPackagingError'
  }
}

export interface ArtifactManifest {
  sha256: string
  fileCount: number
  totalBytes: number
  files: Array<{ path: string; bytes: number }>
}

export interface PackedStaticArtifact {
  tar: Buffer
  manifest: ArtifactManifest
}

export interface MaterializedStaticArtifact {
  root: string
  manifest: ArtifactManifest
}

interface ArtifactFile {
  path: string
  content: Buffer
}

interface ArtifactReadOptions {
  beforeFileOpen?: (absolutePath: string) => Promise<void>
}

interface PinnedRoot {
  path: string
  identity: BigIntStats
  handle: Awaited<ReturnType<typeof open>>
}

function forbiddenPath(path: string): boolean {
  const segments = path.toLowerCase().split('/')
  const base = segments.at(-1) ?? ''
  const forbiddenSegments = new Set([
    '.git',
    '.cache',
    'cache',
    'node_modules',
    'tmp',
    'temp',
    'logs',
  ])
  const forbiddenNames = new Set([
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    '.ds_store',
  ])
  const forbiddenExtensions = [
    '.map',
    '.pem',
    '.key',
    '.p12',
    '.pfx',
    '.db',
    '.sqlite',
    '.sqlite3',
    '.log',
  ]
  return (
    segments.some((segment) => forbiddenSegments.has(segment)) ||
    segments.some((segment) => segment === '.env' || segment.startsWith('.env.')) ||
    forbiddenNames.has(base) ||
    base.startsWith('._') ||
    forbiddenExtensions.some((extension) => base.endsWith(extension))
  )
}

function containsLikelySecret(path: string, content: Buffer): boolean {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (
    !new Set([
      '.css',
      '.csv',
      '.html',
      '.htm',
      '.js',
      '.json',
      '.mjs',
      '.svg',
      '.txt',
      '.webmanifest',
      '.xml',
    ]).has(extension)
  ) {
    return false
  }
  const text = content.toString('utf8')
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bsk-[A-Za-z0-9_-]{32,}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  ].some((pattern) => pattern.test(text))
}

function normalizeRelativePath(root: string, absolutePath: string): string {
  const path = relative(root, absolutePath).split(sep).join('/').normalize('NFC')
  if (
    !path ||
    path === '..' ||
    path.startsWith('../') ||
    path.includes('\\') ||
    Buffer.byteLength(path, 'utf8') > MAX_PATH_BYTES
  ) {
    throw new ArtifactPackagingError(
      'INVALID_ARTIFACT_PATH',
      'Artifact contains an invalid path.'
    )
  }
  return path
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function changedArtifact(): ArtifactPackagingError {
  return new ArtifactPackagingError(
    'INVALID_ARTIFACT_PATH',
    'Artifact changed while it was being validated.'
  )
}

function unsupportedArtifactEntry(): ArtifactPackagingError {
  return new ArtifactPackagingError(
    'UNSUPPORTED_ARTIFACT_ENTRY',
    'Artifact can contain regular non-linked files only.'
  )
}

function noFollowFlags(directory = false): number {
  // Windows/libuv exposes no atomic O_NOFOLLOW flag. On those platforms the
  // opened descriptor is still compared with the pre-open identity and the
  // post-read pathname/realpath before any bytes can enter the artifact.
  const noFollowFlag =
    typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  const directoryFlag = directory && typeof fsConstants.O_DIRECTORY === 'number'
    ? fsConstants.O_DIRECTORY
    : 0
  return fsConstants.O_RDONLY | noFollowFlag | directoryFlag
}

async function assertPinnedRoot(root: PinnedRoot): Promise<void> {
  try {
    const [opened, current, resolved] = await Promise.all([
      root.handle.stat({ bigint: true }),
      lstat(root.path, { bigint: true }),
      realpath(root.path),
    ])
    if (
      !opened.isDirectory() ||
      !current.isDirectory() ||
      resolved !== root.path ||
      !sameIdentity(root.identity, opened) ||
      !sameIdentity(root.identity, current)
    ) {
      throw changedArtifact()
    }
  } catch (error) {
    if (error instanceof ArtifactPackagingError) throw error
    throw changedArtifact()
  }
}

async function readPinnedFile(
  root: PinnedRoot,
  absolutePath: string,
  expected: BigIntStats,
  options: ArtifactReadOptions
): Promise<Buffer> {
  await options.beforeFileOpen?.(absolutePath)
  await assertPinnedRoot(root)

  let handle: Awaited<ReturnType<typeof open>>
  try {
    const resolved = await realpath(absolutePath)
    if (resolved !== absolutePath) throw unsupportedArtifactEntry()
    handle = await open(absolutePath, noFollowFlags())
  } catch (error) {
    if (error instanceof ArtifactPackagingError) throw error
    if (
      error instanceof Error &&
      'code' in error &&
      ['ELOOP', 'EMLINK', 'EFTYPE'].includes(String(error.code))
    ) {
      throw unsupportedArtifactEntry()
    }
    throw changedArtifact()
  }

  try {
    const opened = await handle.stat({ bigint: true })
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      !sameIdentity(expected, opened)
    ) {
      throw unsupportedArtifactEntry()
    }
    const content = await handle.readFile()
    const afterRead = await handle.stat({ bigint: true })
    if (
      !sameIdentity(opened, afterRead) ||
      afterRead.size !== BigInt(content.length)
    ) {
      throw changedArtifact()
    }
    const [current, resolvedAfter] = await Promise.all([
      lstat(absolutePath, { bigint: true }),
      realpath(absolutePath),
    ])
    if (
      resolvedAfter !== absolutePath ||
      !current.isFile() ||
      !sameIdentity(opened, current)
    ) {
      throw changedArtifact()
    }
    await assertPinnedRoot(root)
    return content
  } catch (error) {
    if (error instanceof ArtifactPackagingError) throw error
    throw changedArtifact()
  } finally {
    await handle.close()
  }
}

async function collectFiles(
  root: PinnedRoot,
  options: ArtifactReadOptions
): Promise<ArtifactFile[]> {
  const files: ArtifactFile[] = []
  const collisions = new Set<string>()
  let encodedBytes = TAR_BLOCK_BYTES * 2

  async function walk(directory: string): Promise<void> {
    await assertPinnedRoot(root)
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const info = await lstat(absolutePath, { bigint: true })
      if (info.isSymbolicLink()) {
        throw new ArtifactPackagingError(
          'UNSUPPORTED_ARTIFACT_ENTRY',
          'Artifact cannot contain symbolic links.'
        )
      }
      if (info.isDirectory()) {
        await walk(absolutePath)
        continue
      }
      if (!info.isFile()) {
        throw new ArtifactPackagingError(
          'UNSUPPORTED_ARTIFACT_ENTRY',
          'Artifact can contain regular files only.'
        )
      }

      const path = normalizeRelativePath(root.path, absolutePath)
      if (forbiddenPath(path)) {
        throw new ArtifactPackagingError(
          'FORBIDDEN_ARTIFACT_FILE',
          'Artifact contains a file that cannot be published.'
        )
      }
      const collisionKey = path.toLowerCase()
      if (collisions.has(collisionKey)) {
        throw new ArtifactPackagingError(
          'INVALID_ARTIFACT_PATH',
          'Artifact contains duplicate or case-colliding paths.'
        )
      }
      collisions.add(collisionKey)

      if (info.size < 0n || info.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ArtifactPackagingError(
          'ARTIFACT_LIMIT_EXCEEDED',
          'Artifact contains a file with an unsupported size.'
        )
      }
      const fileSize = Number(info.size)
      const padding =
        (TAR_BLOCK_BYTES - (fileSize % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES
      const nextEncodedBytes =
        encodedBytes + TAR_BLOCK_BYTES + fileSize + padding
      if (nextEncodedBytes > MAX_TAR_BYTES) {
        throw new ArtifactPackagingError(
          'ARTIFACT_LIMIT_EXCEEDED',
          'Encoded artifact exceeds 25 MiB.'
        )
      }
      const content = await readPinnedFile(root, absolutePath, info, options)
      if (containsLikelySecret(path, content)) {
        throw new ArtifactPackagingError(
          'SECRET_DETECTED',
          'Artifact contains likely credential material.'
        )
      }
      files.push({ path, content })
      encodedBytes = nextEncodedBytes
      if (files.length > MAX_FILES) {
        throw new ArtifactPackagingError(
          'ARTIFACT_LIMIT_EXCEEDED',
          'Artifact contains too many files.'
        )
      }
    }
  }

  await walk(root.path)
  await assertPinnedRoot(root)
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  if (!files.some((file) => file.path === 'index.html')) {
    throw new ArtifactPackagingError(
      'MISSING_INDEX',
      'Static artifact requires root index.html.'
    )
  }
  return files
}

async function readArtifactFiles(
  inputPath: string,
  options: ArtifactReadOptions = {}
): Promise<ArtifactFile[]> {
  if (!isAbsolute(inputPath)) {
    throw new ArtifactPackagingError(
      'INVALID_ARTIFACT_PATH',
      'artifact_path must be absolute.'
    )
  }
  const root = await realpath(inputPath)
  const identity = await lstat(root, { bigint: true })
  if (!identity.isDirectory()) {
    throw new ArtifactPackagingError(
      'INVALID_ARTIFACT_PATH',
      'artifact_path must identify a directory.'
    )
  }
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(root, noFollowFlags(true))
  } catch {
    throw unsupportedArtifactEntry()
  }
  const pinnedRoot = { path: root, identity, handle }
  try {
    await assertPinnedRoot(pinnedRoot)
    return await collectFiles(pinnedRoot, options)
  } finally {
    await handle.close()
  }
}

function writeString(buffer: Buffer, offset: number, length: number, value: string) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8')
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number) {
  writeString(
    buffer,
    offset,
    length,
    `${value.toString(8).padStart(length - 1, '0')}\0`
  )
}

function splitUstarPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' }
  for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
    const prefix = path.slice(0, index)
    const name = path.slice(index + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix }
    }
  }
  throw new ArtifactPackagingError(
    'INVALID_ARTIFACT_PATH',
    'Artifact path cannot be represented in USTAR format.'
  )
}

function tarHeader(path: string, size: number): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_BYTES)
  const { name, prefix } = splitUstarPath(path)
  writeString(header, 0, 100, name)
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = 0x30
  writeString(header, 257, 6, 'ustar\0')
  writeString(header, 263, 2, '00')
  writeString(header, 345, 155, prefix)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  writeOctal(header, 148, 8, checksum)
  return header
}

export async function packStaticArtifact(
  inputPath: string,
  options: ArtifactReadOptions = {}
): Promise<PackedStaticArtifact> {
  const files = await readArtifactFiles(inputPath, options)
  return packFiles(files)
}

function packFiles(files: ArtifactFile[]): PackedStaticArtifact {
  const chunks: Buffer[] = []
  for (const file of files) {
    chunks.push(tarHeader(file.path, file.content.length), file.content)
    const padding = (TAR_BLOCK_BYTES - (file.content.length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_BYTES * 2))
  const tar = Buffer.concat(chunks)
  if (tar.length > MAX_TAR_BYTES) {
    throw new ArtifactPackagingError(
      'ARTIFACT_LIMIT_EXCEEDED',
      'Encoded artifact exceeds 25 MiB.'
    )
  }

  return {
    tar,
    manifest: {
      sha256: createHash('sha256').update(tar).digest('hex'),
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.content.length, 0),
      files: files.map((file) => ({ path: file.path, bytes: file.content.length })),
    },
  }
}

export async function materializeStaticArtifact(
  inputPath: string,
  destinationPath: string
): Promise<MaterializedStaticArtifact> {
  if (!isAbsolute(destinationPath)) {
    throw new ArtifactPackagingError(
      'INVALID_ARTIFACT_PATH',
      'Artifact destination must be absolute.'
    )
  }

  const files = await readArtifactFiles(inputPath)
  const packed = packFiles(files)
  const parent = dirname(destinationPath)
  const staging = join(
    parent,
    `.${basename(destinationPath)}.${process.pid}.${randomUUID()}.tmp`
  )
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await mkdir(staging, { mode: 0o700 })

  try {
    for (const file of files) {
      const target = join(staging, ...file.path.split('/'))
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, file.content, { mode: 0o600, flag: 'wx' })
    }
    await rename(staging, destinationPath)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (
      error instanceof Error &&
      'code' in error &&
      ['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
    ) {
      throw new ArtifactPackagingError(
        'INVALID_ARTIFACT_PATH',
        'Artifact destination already exists.'
      )
    }
    throw error
  }

  return { root: destinationPath, manifest: packed.manifest }
}
