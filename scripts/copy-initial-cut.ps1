[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRepository,

    [Parameter(Mandatory = $false)]
    [string]$DestinationRepository = (Split-Path -Parent $PSScriptRoot),

    [Parameter(Mandatory = $false)]
    [string]$HermesHome = (Join-Path $env:LOCALAPPDATA 'hermes')
)

$ErrorActionPreference = 'Stop'

$sourceRoot = [System.IO.Path]::GetFullPath($SourceRepository)
$destinationRoot = [System.IO.Path]::GetFullPath($DestinationRepository)

if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot '.git'))) {
    throw "Source is not a Git repository: $sourceRoot"
}

if (-not (Test-Path -LiteralPath (Join-Path $destinationRoot '.git'))) {
    throw "Destination is not a Git repository: $destinationRoot"
}

if ($sourceRoot -eq $destinationRoot) {
    throw 'Source and destination must be different repositories.'
}

$frontendSelectors = @(
    'apps/chat-web/src',
    'apps/chat-web/public',
    'apps/chat-web/e2e',
    'apps/chat-web/scripts',
    'apps/chat-web/.dockerignore',
    'apps/chat-web/.gitignore',
    'apps/chat-web/.vercelignore',
    'apps/chat-web/app-nexus-ai.env.example',
    'apps/chat-web/components.json',
    'apps/chat-web/Dockerfile',
    'apps/chat-web/eslint.config.js',
    'apps/chat-web/index.html',
    'apps/chat-web/nginx.conf',
    'apps/chat-web/package-lock.json',
    'apps/chat-web/package.json',
    'apps/chat-web/playwright.config.ts',
    'apps/chat-web/postcss.config.js',
    'apps/chat-web/tailwind.config.ts',
    'apps/chat-web/tsconfig.app.json',
    'apps/chat-web/tsconfig.json',
    'apps/chat-web/tsconfig.node.json',
    'apps/chat-web/vercel.json',
    'apps/chat-web/vite.config.ts'
)

$serviceSelectors = @(
    'services/marketing-ops',
    'services/chat-bridge',
    'services/artifact-server'
)

function Get-TrackedFiles {
    param([string[]]$Selectors)

    $files = & git -C $sourceRoot ls-files -- @Selectors
    if ($LASTEXITCODE -ne 0) {
        throw 'git ls-files failed.'
    }

    return @($files | Where-Object { $_ })
}

function Copy-TrackedFiles {
    param([string[]]$Files)

    foreach ($relativePath in $Files) {
        $sourcePath = Join-Path $sourceRoot $relativePath
        $destinationPath = Join-Path $destinationRoot $relativePath
        $resolvedDestination = [System.IO.Path]::GetFullPath($destinationPath)

        if (-not $resolvedDestination.StartsWith($destinationRoot + [System.IO.Path]::DirectorySeparatorChar)) {
            throw "Refusing path outside destination: $relativePath"
        }

        $destinationDirectory = Split-Path -Parent $resolvedDestination
        New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $resolvedDestination -Force
    }
}

function Copy-Skill {
    param(
        [string]$SourceSkill,
        [string]$DestinationName
    )

    $trackedFiles = Get-TrackedFiles -Selectors @($SourceSkill)
    foreach ($relativePath in $trackedFiles) {
        $skillRelativePath = $relativePath.Substring($SourceSkill.Length).TrimStart('/', '\')
        $sourcePath = Join-Path $sourceRoot $relativePath
        $destinationPath = Join-Path $destinationRoot (Join-Path 'agents\ens\skills' (Join-Path $DestinationName $skillRelativePath))
        $destinationDirectory = Split-Path -Parent $destinationPath
        New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }

    return $trackedFiles.Count
}

$frontendFiles = Get-TrackedFiles -Selectors $frontendSelectors
$serviceFiles = Get-TrackedFiles -Selectors $serviceSelectors

Copy-TrackedFiles -Files $frontendFiles
Copy-TrackedFiles -Files $serviceFiles

$soulPath = Join-Path ([System.IO.Path]::GetFullPath($HermesHome)) 'SOUL.md'
if (-not (Test-Path -LiteralPath $soulPath)) {
    throw "Hermes SOUL.md not found: $soulPath"
}

$sensitiveSoulPattern = '(?i)(api[_ -]?key|bearer\s+[A-Za-z0-9._-]{12,}|sk-[A-Za-z0-9]{12,}|password\s*[:=]|secret\s*[:=]|token\s*[:=])'
if (Select-String -LiteralPath $soulPath -Pattern $sensitiveSoulPattern -Quiet) {
    throw 'SOUL.md contains a credential-shaped value and was not copied.'
}

Copy-Item -LiteralPath $soulPath -Destination (Join-Path $destinationRoot 'agents\ens\SOUL.md') -Force

$skillMappings = @(
    @('services/hermes-runtime/skills/picture-hermes', 'picture-hermes'),
    @('services/hermes-runtime/vendor/hermes-agent/skills/marketing/marketing-ops-operator', 'marketing-ops-operator'),
    @('services/hermes-runtime/vendor/hermes-agent/skills/creative/nexus-brand-extract', 'nexus-brand-extract'),
    @('services/hermes-runtime/vendor/hermes-agent/skills/creative/nexus-frontend-arsenal', 'nexus-frontend-arsenal'),
    @('services/hermes-runtime/vendor/hermes-agent/skills/creative/nexus-direction-picker', 'nexus-direction-picker'),
    @('services/hermes-runtime/vendor/hermes-agent/skills/creative/nexus-token-map', 'nexus-token-map')
)

$skillFileCount = 0
foreach ($mapping in $skillMappings) {
    $skillFileCount += Copy-Skill -SourceSkill $mapping[0] -DestinationName $mapping[1]
}

[pscustomobject]@{
    FrontendFiles = $frontendFiles.Count
    ServiceFiles = $serviceFiles.Count
    TotalFiles = $frontendFiles.Count + $serviceFiles.Count
    SkillFiles = $skillFileCount
    Soul = $soulPath
    Source = $sourceRoot
    Destination = $destinationRoot
}
