import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MINIMUM_HERMES_VERSION = [0, 20, 6];
const FORBIDDEN_PATH_PARTS = new Set([
  '.env',
  'auth.json',
  'state.db',
  'sessions',
  'memories',
  'mcp-tokens',
]);

function parseTopLevelScalar(source, key) {
  const expression = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm');
  const match = source.match(expression);
  return match?.[1]?.replace(/^(["'])(.*)\1$/, '$2');
}

function parseListBlock(source, key) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return [];

  const values = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (match) values.push(match[1].replace(/^(["'])(.*)\1$/, '$2'));
  }
  return values;
}

function parseEnvironmentNames(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === 'env_requires:');
  if (start === -1) return [];

  const names = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s*-\s+name:\s*([A-Z][A-Z0-9_]*)\s*$/);
    if (match) names.push(match[1]);
  }
  return names;
}

function isInside(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..');
}

function walkFiles(root) {
  const files = [];
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const destination = resolve(current, entry.name);
      if (entry.isDirectory()) pending.push(destination);
      if (entry.isFile()) files.push(destination);
    }
  }

  return files;
}

function versionAtLeast(requirement, minimum) {
  const match = requirement?.match(/^>=(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

export function validateHermesDistribution(inputDirectory) {
  const root = resolve(inputDirectory);
  const errors = [];

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [`distribution directory does not exist: ${root}`];
  }

  const manifestPath = resolve(root, 'distribution.yaml');
  const configPath = resolve(root, 'config.yaml');
  const mcpPath = resolve(root, 'mcp.json');
  for (const requiredPath of [manifestPath, configPath, mcpPath]) {
    if (!existsSync(requiredPath)) errors.push(`required file does not exist: ${basename(requiredPath)}`);
  }
  if (errors.length > 0) return errors;

  const manifest = readFileSync(manifestPath, 'utf8');
  const config = readFileSync(configPath, 'utf8');
  const distributionName = parseTopLevelScalar(manifest, 'name');
  const hermesRequirement = parseTopLevelScalar(manifest, 'hermes_requires');
  const ownedPaths = parseListBlock(manifest, 'distribution_owned');
  const declaredEnvironment = new Set(parseEnvironmentNames(manifest));

  if (distributionName !== 'ens') errors.push('name must be exactly "ens"');
  if (!versionAtLeast(hermesRequirement, MINIMUM_HERMES_VERSION)) {
    errors.push('hermes_requires must require at least 0.20.6 using the >= comparator');
  }

  for (const ownedPath of ownedPaths) {
    const destination = resolve(root, ownedPath);
    if (!isInside(root, destination)) {
      errors.push(`distribution_owned path escapes the distribution: ${ownedPath}`);
    } else if (!existsSync(destination)) {
      errors.push(`distribution_owned path does not exist: ${ownedPath}`);
    }
  }

  const meaningfulConfig = config
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  if (/^\s*(provider|model)\s*:/im.test(meaningfulConfig)) {
    errors.push('config.yaml must not contain a provider or model setting');
  }
  if (/^\s*(api[_-]?key|token|secret|password)\s*:/im.test(meaningfulConfig)) {
    errors.push('config.yaml must not contain a secret-like setting');
  }

  let mcp = {};
  try {
    mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
  } catch (error) {
    errors.push(`mcp.json is not valid JSON: ${error.message}`);
  }

  const marketingOpsInConfig = /^\s{2}nexus_marketing_ops\s*:/m.test(config) ? 1 : 0;
  const marketingOpsInJson = Object.hasOwn(mcp?.mcpServers ?? {}, 'nexus_marketing_ops') ? 1 : 0;
  if (marketingOpsInConfig + marketingOpsInJson !== 1) {
    errors.push('nexus_marketing_ops must be defined exactly once across config.yaml and mcp.json');
  }

  const files = walkFiles(root);
  const usedEnvironment = new Set();
  for (const file of files) {
    const relativePath = relative(root, file).replaceAll('\\', '/');
    const pathParts = relativePath.toLowerCase().split('/');
    const forbiddenPart = pathParts.find((part) => FORBIDDEN_PATH_PARTS.has(part));
    if (forbiddenPart) errors.push(`forbidden state path: ${relativePath}`);

    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) {
      usedEnvironment.add(match[1]);
    }
  }

  for (const variable of usedEnvironment) {
    if (!declaredEnvironment.has(variable)) {
      errors.push(`environment variable is not declared: ${variable}`);
    }
  }

  return [...new Set(errors)];
}

export function runCli(args = process.argv.slice(2)) {
  const directory = args[0] ?? 'agents/ens';
  const errors = validateHermesDistribution(directory);
  if (errors.length === 0) {
    console.log(`ENS profile distribution is valid: ${resolve(directory)}`);
    return 0;
  }

  console.error(`ENS profile distribution is invalid (${errors.length} error(s)):`);
  for (const error of errors) console.error(`- ${error}`);
  return 1;
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entrypoint === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli();
}
