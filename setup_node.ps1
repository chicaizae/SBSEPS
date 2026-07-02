# Download and setup portable Node.js and npm
$url = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip"
$zipPath = "c:\Users\edison.chicaiza\OneDrive - Ecoilpet S.A\Documentos\16. AUTOMATIZACION\PRUEBA\node.zip"
$extractPath = "c:\Users\edison.chicaiza\OneDrive - Ecoilpet S.A\Documentos\16. AUTOMATIZACION\PRUEBA\node-portable"

Write-Host "Downloading Node.js from $url..."
try {
    # Set SecurityProtocol to TLS1.2
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    Write-Host "Download complete. Extracting to $extractPath..."
    
    if (Test-Path $extractPath) {
        Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    # Expand-Archive extracts node-v20.11.1-win-x64 inside $extractPath
    Expand-Archive -Path $zipPath -DestinationPath $extractPath
    
    # Move files up one level so node.exe is directly in node-portable
    $subDir = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
    if ($subDir) {
        Get-ChildItem -Path $subDir.FullName | Move-Item -Destination $extractPath -Force
        Remove-Item -Path $subDir.FullName -Recurse -Force
    }
    
    # Remove ZIP file
    Remove-Item -Path $zipPath -Force
    
    Write-Host "Node.js portable setup completed successfully!"
    
    # Verify installation
    $nodeExe = Join-Path $extractPath "node.exe"
    $npmCmd = Join-Path $extractPath "npm.cmd"
    
    if (Test-Path $nodeExe) {
        Write-Host "node.exe version:"
        & $nodeExe -v
    }
    if (Test-Path $npmCmd) {
        Write-Host "npm version:"
        & $npmCmd -v
    }
}
catch {
    Write-Error "Failed to set up Node.js: $_"
}
