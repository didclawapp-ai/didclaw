#Requires -Version 5.1
# 须以 UTF-8 **带 BOM** 保存：否则 Windows PowerShell 5.1 用系统 ANSI 解析，中文会乱码并触发 ParserError。
<#
.SYNOPSIS
  纯 Windows：检测 openclaw；缺失则用官方 install.ps1 安装（-NoOnboard）；再可选执行官方非交互 onboard。

.DESCRIPTION
  - 安装 CLI：下载 https://openclaw.ai/install.ps1，子进程执行 -NoOnboard（与官方一致）。
  - 引导：使用官方一次性非交互命令（见 https://openclaws.io/docs/start/wizard-cli-automation ）。
  - 默认模型提供方：Pollinations（OpenAI 兼容网关 https://gen.pollinations.ai ，说明见 https://pollinations.ai 与 https://enter.pollinations.ai/api/docs ）。
    若有 POLLINATIONS_API_KEY（或 -PollinationsApiKey）则走 Pollinations；否则默认自动改为 skip，仍会完成 onboard（写入配置等）。
    **默认不** 向官方 onboard 传 --install-daemon：避免计划任务 + gateway.cmd 弹出独立 CMD；网关由 LCLaw 无窗子进程拉起。需要官方「登录即起网关」时请加 -InstallGatewayDaemon。
    若必须配置 Pollinations 才允许继续：加 -RequirePollinationsApiKey（缺密钥则退出码 5）。

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File .\ensure-openclaw-windows.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\ensure-openclaw-windows.ps1 -SkipOnboard
    powershell -NoProfile -ExecutionPolicy Bypass -File .\ensure-openclaw-windows.ps1 -OllamaModelId 'qwen3.5:7b'
    $env:POLLINATIONS_API_KEY='sk_...'; .\ensure-openclaw-windows.ps1
    powershell ...\ensure-openclaw-windows.ps1 -OnboardAuthChoice ollama
    # 无 Ollama：只装网关/工作区，模型稍后在本机或 LCLaw 里配置
    powershell ...\ensure-openclaw-windows.ps1 -OnboardAuthChoice skip
    # 未装 Ollama 时仍希望无人值守跑完 onboard（自动改为 skip 并提示）
    powershell ...\ensure-openclaw-windows.ps1 -FallbackToSkipAuthIfOllamaUnreachable
    # 必须本机已起 Ollama 才继续，否则退出码 4
    powershell ...\ensure-openclaw-windows.ps1 -FailIfOllamaUnreachable
    # 缺 Pollinations 密钥时必须失败（不要自动 skip）
    powershell ...\ensure-openclaw-windows.ps1 -RequirePollinationsApiKey
    # 需要官方「登录启动」计划任务 + gateway.cmd（会多一个 CMD 窗口）时：
    powershell ...\ensure-openclaw-windows.ps1 -InstallGatewayDaemon

  参数也可从 ensure-openclaw-windows.bat 传入：ensure-openclaw-windows.bat -SkipOnboard
#>

[CmdletBinding()]
param(
    # 跳过「非交互 onboard」（仅安装/检测 CLI）
    [switch]$SkipOnboard,
    # 与交互向导中 Ollama 模型一致；若本机无此模型，onboard 可能报错，可改参数或先在 Ollama 中拉取
    [string]$OllamaModelId = 'glm-4.7-flash',
    [string]$OllamaBaseUrl = 'http://127.0.0.1:11434',
    [int]$GatewayPort = 18789,
    # 非交互 onboard 时跳过健康检查（无人值守/CI 可选用）
    [switch]$SkipHealth,
    # onboard 时的模型来源：pollinations（默认，OpenAI 兼容 + 需 API Key）| ollama | skip
    [ValidateSet('pollinations', 'ollama', 'skip')]
    [string]$OnboardAuthChoice = 'pollinations',
    # Pollinations：注册 https://enter.pollinations.ai/ ；亦可设环境变量 POLLINATIONS_API_KEY
    [string]$PollinationsApiKey = '',
    # 见 https://gen.pollinations.ai/v1/models ，如 openai、openai-fast
    [string]$PollinationsModelId = 'openai',
    # 选择 ollama 时：若检测不到本机 Ollama API，则自动改用 skip 并继续
    [switch]$FallbackToSkipAuthIfOllamaUnreachable,
    # 选择 ollama 且本机 API 不可达时直接失败（退出码 4）；与「仅警告仍走 ollama」互斥，适合要严格环境的安装器
    [switch]$FailIfOllamaUnreachable,
    # 不探测 Ollama（本地未监听 11434 但仅用 Ollama Cloud 等场景可开）
    [switch]$SkipOllamaPreflight,
    # 已选 pollinations 但未提供密钥时直接退出码 5（默认改为 skip 并继续完成网关安装）
    [switch]$RequirePollinationsApiKey,
    # 向官方 onboard 传入 --install-daemon（计划任务 + gateway.cmd，通常会弹出独立控制台；LCLaw 桌面版默认不需要）
    [switch]$InstallGatewayDaemon
)

# 勿对本机脚本开 StrictMode：官方 install.ps1 在部分分支会读到尚未赋值的变量；
# 也不要在同一进程里直接 & 调用 install.ps1，以免继承本脚本的 EAP。
$ErrorActionPreference = 'Stop'

# 子进程重定向时 Write-Host 常不进 stdout；需要进 LCLaw 流式日志时同时 Write-Output。
function Write-UiLine {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [ValidateSet('', 'Yellow', 'Red', 'Green', 'DarkGray')]
        [string]$ForegroundColor = ''
    )
    Write-Output $Text
    switch ($ForegroundColor) {
        'Yellow' { Write-Host $Text -ForegroundColor Yellow; break }
        'Red' { Write-Host $Text -ForegroundColor Red; break }
        'Green' { Write-Host $Text -ForegroundColor Green; break }
        'DarkGray' { Write-Host $Text -ForegroundColor DarkGray; break }
        default { Write-Host $Text }
    }
}

function Sync-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ([string]::IsNullOrEmpty($machine)) { $machine = '' }
    if ([string]::IsNullOrEmpty($user)) { $user = '' }
    $env:Path = ($machine.TrimEnd(';') + ';' + $user.TrimEnd(';')).Trim(';')
}

function Test-OllamaApiReachable {
    param([Parameter(Mandatory = $true)][string]$BaseUrl)
    $u = $BaseUrl.TrimEnd('/')
    try {
        Invoke-WebRequest -Uri ($u + '/api/tags') -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Test-OpenclawOnPath {
    try {
        # 多个 PATHEXT 命中时 Get-Command 可能返回数组，.Source 会变成 string[]，无法绑定 [string] 参数。
        $cmds = @(Get-Command openclaw -CommandType Application -ErrorAction Stop)
        if ($cmds.Count -lt 1) { return $null }
        $src = $cmds[0].Source
        if ([string]::IsNullOrWhiteSpace($src)) { return $null }
        return [string]$src
    } catch {
        return $null
    }
}

function Invoke-OpenclawOnboardNonInteractive {
    param(
        [Parameter(Mandatory = $true)]
        [string]$OpenclawExe,
        [ValidateSet('pollinations', 'ollama', 'skip')]
        [string]$AuthChoice,
        [string]$ModelId,
        [string]$BaseUrl,
        [string]$PollinationsKey,
        [string]$PollinationsModel,
        [int]$Port,
        [switch]$SkipHealthCheck,
        [switch]$InstallGatewayDaemon
    )

    $onboardArgs = [System.Collections.Generic.List[string]]::new()
    $onboardArgs.Add('onboard')
    $onboardArgs.Add('--non-interactive')
    $onboardArgs.Add('--accept-risk')
    $onboardArgs.Add('--mode')
    $onboardArgs.Add('local')
    $onboardArgs.Add('--flow')
    $onboardArgs.Add('quickstart')
    if ($AuthChoice -eq 'pollinations') {
        $onboardArgs.Add('--auth-choice')
        $onboardArgs.Add('custom-api-key')
        $onboardArgs.Add('--custom-base-url')
        $onboardArgs.Add('https://gen.pollinations.ai/v1')
        $onboardArgs.Add('--custom-model-id')
        $onboardArgs.Add($PollinationsModel)
        $onboardArgs.Add('--custom-compatibility')
        $onboardArgs.Add('openai')
        $onboardArgs.Add('--custom-api-key')
        $onboardArgs.Add($PollinationsKey)
        $onboardArgs.Add('--secret-input-mode')
        $onboardArgs.Add('plaintext')
    } else {
        $onboardArgs.Add('--auth-choice')
        $onboardArgs.Add($AuthChoice)
        if ($AuthChoice -eq 'ollama') {
            if (-not [string]::IsNullOrWhiteSpace($BaseUrl)) {
                $onboardArgs.Add('--custom-base-url')
                $onboardArgs.Add($BaseUrl)
            }
            if (-not [string]::IsNullOrWhiteSpace($ModelId)) {
                $onboardArgs.Add('--custom-model-id')
                $onboardArgs.Add($ModelId)
            }
        }
    }
    $onboardArgs.Add('--gateway-port')
    $onboardArgs.Add("$Port")
    $onboardArgs.Add('--gateway-bind')
    $onboardArgs.Add('loopback')
    if ($InstallGatewayDaemon) {
        $onboardArgs.Add('--install-daemon')
        $onboardArgs.Add('--daemon-runtime')
        $onboardArgs.Add('node')
    }
    $onboardArgs.Add('--skip-channels')
    $onboardArgs.Add('--skip-search')
    $onboardArgs.Add('--skip-skills')
    $onboardArgs.Add('--skip-ui')
    if ($SkipHealthCheck) {
        $onboardArgs.Add('--skip-health')
    }

    $flowDesc = switch ($AuthChoice) {
        'pollinations' { 'QuickStart + Pollinations（OpenAI 兼容）+ 跳过频道/搜索/技能/UI 提示' }
        'ollama' { 'QuickStart + Ollama + 跳过频道/搜索/技能/UI 提示' }
        default { 'QuickStart + 跳过模型/API（auth skip）+ 跳过频道/搜索/技能/UI 提示' }
    }
    Write-UiLine ('[ensure-openclaw] 执行官方非交互 onboard（{0}）...' -f $flowDesc) -ForegroundColor Yellow
    if ($InstallGatewayDaemon) {
        Write-UiLine '[ensure-openclaw] 已启用 -InstallGatewayDaemon：将注册官方 Gateway 计划任务（可能单独弹出 CMD）。' -ForegroundColor DarkGray
    } else {
        Write-UiLine '[ensure-openclaw] 未安装 Gateway 计划任务；请由 LCLaw 启动本机网关（无窗）或手动 openclaw gateway。' -ForegroundColor DarkGray
    }
    Write-UiLine ('[ensure-openclaw] 文档: https://openclaws.io/docs/start/wizard-cli-automation' ) -ForegroundColor DarkGray
    Write-Output '[ensure-openclaw] ui=onboard_exec'

    & $OpenclawExe @($onboardArgs.ToArray())
    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw ('openclaw onboard 退出码: {0}' -f $LASTEXITCODE)
    }
}

Sync-PathFromRegistry
$openclawExe = Test-OpenclawOnPath

if (-not $openclawExe) {
    Write-UiLine '[ensure-openclaw] 未检测到 openclaw，开始执行官方安装脚本（-NoOnboard）...' -ForegroundColor Yellow
    Write-UiLine '[ensure-openclaw] 需要联网下载 https://openclaw.ai/install.ps1' -ForegroundColor DarkGray
    Write-Output '[ensure-openclaw] ui=stage_cli_install_begin'

    $tmpInstall = $null
    try {
        $tmpInstall = Join-Path ([System.IO.Path]::GetTempPath()) ('openclaw-install-{0}.ps1' -f [guid]::NewGuid())
        Write-Output '[ensure-openclaw] ui=downloading_official_install_ps1'
        Invoke-WebRequest -Uri 'https://openclaw.ai/install.ps1' -UseBasicParsing -OutFile $tmpInstall -TimeoutSec 300

        if (-not (Test-Path -LiteralPath $tmpInstall)) {
            throw '临时安装脚本未写入磁盘。'
        }
        if ((Get-Item -LiteralPath $tmpInstall).Length -lt 200) {
            throw '下载内容过短，可能不是有效的 install.ps1（网络拦截或错误页）。'
        }

        Write-Output '[ensure-openclaw] ui=running_official_install_ps1_wait'
        $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
            '-NoProfile'
            '-ExecutionPolicy', 'Bypass'
            '-File', $tmpInstall
            '-NoOnboard'
        ) -Wait -PassThru -NoNewWindow

        if ($null -ne $proc.ExitCode -and $proc.ExitCode -ne 0) {
            throw ('官方 install.ps1 退出码: {0}' -f $proc.ExitCode)
        }
        Write-Output '[ensure-openclaw] ui=official_install_ps1_finished'
    } catch {
        Write-UiLine ('[ensure-openclaw] 下载或执行安装脚本失败: {0}' -f $_) -ForegroundColor Red
        exit 1
    } finally {
        if ($tmpInstall -and (Test-Path -LiteralPath $tmpInstall)) {
            Remove-Item -LiteralPath $tmpInstall -Force -ErrorAction SilentlyContinue
        }
    }

    Sync-PathFromRegistry
    $openclawExe = Test-OpenclawOnPath
    if (-not $openclawExe) {
        Write-UiLine '[ensure-openclaw] 安装已完成，但当前会话仍找不到 openclaw。' -ForegroundColor Yellow
        Write-UiLine '  请关闭并重新打开终端，或检查 npm 全局目录是否已加入用户 PATH。' -ForegroundColor Yellow
        Write-UiLine '  可运行: npm prefix -g' -ForegroundColor DarkGray
        exit 2
    }

    Write-UiLine ('[ensure-openclaw] CLI 安装完成: {0}' -f $openclawExe) -ForegroundColor Green
} else {
    Write-UiLine ('[ensure-openclaw] 已检测到 openclaw: {0} — 跳过 CLI 安装。' -f $openclawExe) -ForegroundColor Green
}

if ($SkipOnboard) {
    Write-UiLine '[ensure-openclaw] 已指定 -SkipOnboard，跳过 onboard。' -ForegroundColor DarkGray
    exit 0
}

$effectiveAuth = $OnboardAuthChoice
$pollinationsKeyResolved = $PollinationsApiKey
if ([string]::IsNullOrWhiteSpace($pollinationsKeyResolved)) {
    $pollinationsKeyResolved = [Environment]::GetEnvironmentVariable('POLLINATIONS_API_KEY', 'User')
}
if ([string]::IsNullOrWhiteSpace($pollinationsKeyResolved)) {
    $pollinationsKeyResolved = [Environment]::GetEnvironmentVariable('POLLINATIONS_API_KEY', 'Machine')
}
if ([string]::IsNullOrWhiteSpace($pollinationsKeyResolved)) {
    $pollinationsKeyResolved = $env:POLLINATIONS_API_KEY
}

if ($effectiveAuth -eq 'pollinations' -and [string]::IsNullOrWhiteSpace($pollinationsKeyResolved)) {
    if ($RequirePollinationsApiKey) {
        Write-UiLine '[ensure-openclaw] 已选 Pollinations 且指定 -RequirePollinationsApiKey，但未提供 API 密钥。' -ForegroundColor Red
        Write-UiLine '  请到 https://enter.pollinations.ai/ 注册并创建 sk_ 密钥，然后：' -ForegroundColor Yellow
        Write-UiLine '    设置环境变量 POLLINATIONS_API_KEY，或: -PollinationsApiKey ''sk_...''' -ForegroundColor DarkGray
        exit 5
    }
    Write-UiLine '[ensure-openclaw] 未检测到 POLLINATIONS_API_KEY，将改用 --auth-choice skip 以完成 onboard（写入配置；默认不装计划任务）。' -ForegroundColor Yellow
    Write-UiLine '  稍后可设密钥并重跑本脚本（仅 onboard），或: openclaw configure / LCLaw 内配置 Pollinations。' -ForegroundColor DarkGray
    Write-UiLine '  注册密钥: https://enter.pollinations.ai/' -ForegroundColor DarkGray
    $effectiveAuth = 'skip'
}

if ($effectiveAuth -eq 'ollama' -and -not $SkipOllamaPreflight) {
    if (-not (Test-OllamaApiReachable -BaseUrl $OllamaBaseUrl)) {
        Write-UiLine ('[ensure-openclaw] 未检测到本机 Ollama HTTP API（{0}/api/tags 不可达）。' -f ($OllamaBaseUrl.TrimEnd('/'))) -ForegroundColor Yellow
        Write-UiLine '  若需本机推理：安装并启动 Ollama — https://ollama.com/download 或 winget install Ollama.Ollama' -ForegroundColor DarkGray
        Write-UiLine '  若仅用云端/向导自处理：可忽略，或加 -SkipOllamaPreflight 去掉本提示。' -ForegroundColor DarkGray
        Write-UiLine '  无人值守且无 Ollama：加 -OnboardAuthChoice skip 或 -FallbackToSkipAuthIfOllamaUnreachable。' -ForegroundColor DarkGray
        if ($FallbackToSkipAuthIfOllamaUnreachable) {
            Write-UiLine '[ensure-openclaw] 已启用 -FallbackToSkipAuthIfOllamaUnreachable，onboard 将使用 --auth-choice skip（请稍后配置模型）。' -ForegroundColor Yellow
            $effectiveAuth = 'skip'
        } elseif ($FailIfOllamaUnreachable) {
            exit 4
        }
    }
}

Write-Output '[ensure-openclaw] ui=onboard_prepare'
try {
    Invoke-OpenclawOnboardNonInteractive -OpenclawExe $openclawExe -AuthChoice $effectiveAuth `
        -ModelId $OllamaModelId -BaseUrl $OllamaBaseUrl `
        -PollinationsKey $pollinationsKeyResolved -PollinationsModel $PollinationsModelId `
        -Port $GatewayPort -SkipHealthCheck:$SkipHealth -InstallGatewayDaemon:$InstallGatewayDaemon
} catch {
    Write-UiLine ('[ensure-openclaw] onboard 失败: {0}' -f $_) -ForegroundColor Red
    exit 3
}

Write-UiLine '[ensure-openclaw] onboard 已完成。' -ForegroundColor Green
exit 0
