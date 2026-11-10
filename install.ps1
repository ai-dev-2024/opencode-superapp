# One-click installer: turn OpenCode into a super-app (Windows PowerShell 5.1 and PowerShell 7+).
# Usage:
#   .\install.ps1                          # interactive menu: superapp first, then stacks
#   .\install.ps1 -Superapp                # zero-API-key essentials (recommended start)
#   .\install.ps1 -Stack web-dev           # install a whole stack into .\opencode.json
#   .\install.ps1 -Add github,sentry       # install individual servers
#   .\install.ps1 -Add github -Global      # install into ~/.config/opencode/opencode.json
#   .\install.ps1 -List                    # list every server
#   .\install.ps1 -Search postgres         # searchable index
#   .\install.ps1 -Validate                # check the kit's own files
# -Global, -Config PATH, -Force and -DryRun apply to every command that writes a config,
# including the menu.
#
# Keep this file pure ASCII. Windows PowerShell 5.1 reads a script without a BOM in the ANSI
# code page, where the last byte of a UTF-8 dash becomes a curly quote. PowerShell treats
# curly quotes as string delimiters, so one such character stops the whole file parsing.
[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Stack,
  [string[]]$Add,
  [switch]$Superapp,
  [switch]$Global,
  [string]$Config,
  [switch]$Force,
  [switch]$DryRun,
  [switch]$List,
  [string]$Search,
  [switch]$Validate
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "node >=18 is required (https://nodejs.org). Install it, then re-run."
}
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) {
  Write-Error "node >=18 is required, found $(& node --version). Upgrade it, then re-run."
}

$scripts = Join-Path $PSScriptRoot "scripts"
$manager = Join-Path $scripts "mcp-manager.mjs"

# Options for the commands that write a config.
$writeOptions = @()
if ($Global) { $writeOptions += "--global" }
if ($Config) { $writeOptions += @("--config", $Config) }
if ($Force) { $writeOptions += "--force" }
if ($DryRun) { $writeOptions += "--dry-run" }

# Run node and end the script with node's exit code, so callers and CI see failures.
function Invoke-Kit {
  param([string[]]$Arguments)
  & node @Arguments
  exit $LASTEXITCODE
}

if ($Validate) { Invoke-Kit @((Join-Path $scripts "validate.mjs")) }
if ($List) { Invoke-Kit @($manager, "list") }
if ($Search) { Invoke-Kit @($manager, "search", $Search) }
if ($Superapp) { Invoke-Kit (@($manager, "stack", "superapp") + $writeOptions) }
if ($Stack) { Invoke-Kit (@($manager, "stack", $Stack) + $writeOptions) }
if ($Add) {
  # "-Add a,b" arrives as one string when the script is started with powershell -File.
  $ids = @($Add | ForEach-Object { $_ -split "," } | Where-Object { $_ })
  Invoke-Kit (@($manager, "add") + $ids + $writeOptions)
}

# interactive menu
Write-Output "OpenCode super-app installer - pick one:"
Write-Output "  0) superapp      (8 zero-key essentials - start here)"
Write-Output "  1) web-dev       (files, git, browser, hosting, UI)"
Write-Output "  2) data-analysis (SQL/NoSQL + reasoning memory)"
Write-Output "  3) devops        (containers, IaC, clouds, observability)"
Write-Output "  4) ai-search     (web search, scrape, docs grounding)"
Write-Output "  5) productivity  (tickets, docs, chat)"
Write-Output "  6) testing       (browsers, perf, reference harness)"
$choice = Read-Host "Choice [0-6]"
$menu = @{
  "0" = "superapp"; "" = "superapp"; "1" = "web-dev"; "2" = "data-analysis"; "3" = "devops"
  "4" = "ai-search"; "5" = "productivity"; "6" = "testing"
}
if (-not $menu.ContainsKey($choice)) {
  Write-Output "cancelled"
  exit 0
}
Invoke-Kit (@($manager, "stack", $menu[$choice]) + $writeOptions)
