$ErrorActionPreference = "Continue"

$jobs = @()

Write-Host "Starting Control Server (Port 3001)..."
$jobs += Start-Process "npm.cmd" -ArgumentList "start" -WorkingDirectory "c:\Users\mapay\Desktop\PUBG LIVE\web\control\server" -WindowStyle Hidden -PassThru

Write-Host "Starting Control Client (Port 5173)..."
$jobs += Start-Process "npm.cmd" -ArgumentList "run dev" -WorkingDirectory "c:\Users\mapay\Desktop\PUBG LIVE\web\control\client" -WindowStyle Hidden -PassThru

Write-Host "Starting Ranking System (Port 3000)..."
$jobs += Start-Process "npm.cmd" -ArgumentList "start" -WorkingDirectory "c:\Users\mapay\Desktop\PUBG LIVE\web\รับบบเปลี่ยน ranking" -WindowStyle Hidden -PassThru

Write-Host "Starting Random Map System (Port 3002)..."
## Using cmd.exe to set port and run npm start in same context
$jobs += Start-Process "cmd.exe" -ArgumentList "/c `"set PORT=3002 && npm start`"" -WorkingDirectory "c:\Users\mapay\Desktop\PUBG LIVE\web\random map" -WindowStyle Hidden -PassThru

Write-Host "Starting vMix Mobile (Port 8000)..."
$jobs += Start-Process "node.exe" -ArgumentList "server.js" -WorkingDirectory "c:\Users\mapay\Desktop\PUBG LIVE\web\vmix-mobile" -WindowStyle Hidden -PassThru

Write-Host "Waiting 20 seconds for all servers to fully start (Frontend like Vite takes a few seconds)..."
Start-Sleep -Seconds 20

Write-Host "Testing port 5173 to ensure servers are up..."
$up = $false
try {
    $res = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing
    if ($res.StatusCode -eq 200) { $up = $true }
} catch {
}

if (-not $up) {
    Write-Host "WARNING: Frontend server (5173) still down!"
} else {
    Write-Host "Frontend server is UP."
}

Write-Host "Running Playwright Tests..."
Set-Location "c:\Users\mapay\Desktop\PUBG LIVE\web"
npx playwright test
$testExitCode = $LASTEXITCODE

Write-Host "Tests completed. Cleaning up background servers..."
foreach ($job in $jobs) {
    if ($job -and -not $job.HasExited) {
        taskkill /T /F /PID $job.Id 2>&1 | Out-Null
    }
}
Write-Host "All tests finished. Playwright exit code: $testExitCode"
