param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8765
)

$ErrorActionPreference = "Stop"
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)

try {
    $listener.Start()
    Write-Host ""
    Write-Host "PORTA 127.0.0.1:$Port OCUPADA POR UM LISTENER NÃO-TDA." -ForegroundColor Yellow
    Write-Host "Volte ao teste principal e confirme que o Companion detecta conflito/incompatibilidade."
    Write-Host ""
    [void](Read-Host "Quando terminar a observação, pressione ENTER AQUI para liberar a porta")
}
finally {
    try { $listener.Stop() } catch {}
    Write-Host "Porta liberada." -ForegroundColor Green
}
