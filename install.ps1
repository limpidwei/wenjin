#Requires -Version 5.1
param(
    # 安装目标：技能目录。默认 Claude Code；Hermes 传 "$env:LOCALAPPDATA\hermes\skills\research"
    [string]$Target = "$env:USERPROFILE\.claude\skills"
)
$ErrorActionPreference = 'Stop'

$repo = 'limpidwei/wenjin'
$tmp  = Join-Path $env:TEMP ("wenjin-install-" + [guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $zip = Join-Path $tmp 'repo.zip'
    Write-Host "正在下载 $repo ..."
    Invoke-WebRequest -Uri "https://codeload.github.com/$repo/zip/refs/heads/main" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $tmp
    $src = Join-Path $tmp 'wenjin-main'
    if (-not (Test-Path (Join-Path $src 'SKILL.md'))) { throw "下载内容不完整：未找到 SKILL.md" }

    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    $dst = Join-Path $Target 'wenjin'
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    Copy-Item $src $dst -Recurse

    Write-Host ""
    Write-Host "[OK] 问津（wenjin）已安装到 $dst" -ForegroundColor Green
    Write-Host "研究主流程零依赖，装完即可用：在 Claude Code 里说「深度调研 + 你的问题」。"
    Write-Host "（可选）HTML/PDF 出版链：cd `"$dst`"; npm ci; ./node_modules/.bin/playwright install chromium"
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
