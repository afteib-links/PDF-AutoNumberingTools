# file:// では Edge が同一 HTML をフレーム読み込みしようとして警告する。
# このスクリプトはローカル HTTP で開き、その制限を回避する。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$port = 8765
$prefix = "http://127.0.0.1:$port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
} catch {
    $port = 8766
    $prefix = "http://127.0.0.1:$port/"
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($prefix)
    $listener.Start()
}

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.woff' = 'font/woff'
    '.ttf'  = 'font/ttf'
    '.md'   = 'text/plain; charset=utf-8'
}

Start-Process $prefix
Write-Host "PDF配置ツール: $prefix"
Write-Host "この窓を閉じるとサーバーも終了します。"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $reqPath = [Uri]::UnescapeDataString($ctx.Request.Url.LocalPath)
    if ([string]::IsNullOrEmpty($reqPath) -or $reqPath -eq '/') {
        $reqPath = '/index.html'
    }
    if ($reqPath.Contains('..')) {
        $ctx.Response.StatusCode = 400
        $ctx.Response.Close()
        continue
    }
    $rel = $reqPath.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
    $full = Join-Path $root $rel
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $ctx.Response.StatusCode = 404
        $ctx.Response.Close()
        continue
    }
    $bytes = [IO.File]::ReadAllBytes($full)
    $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
    if ($mime.ContainsKey($ext)) {
        $ctx.Response.ContentType = $mime[$ext]
    } else {
        $ctx.Response.ContentType = 'application/octet-stream'
    }
    $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
}
