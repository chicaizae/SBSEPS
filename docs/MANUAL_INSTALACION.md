# Manual de Instalacion - SBSEPS v1.0

## 1. Requisitos

- Linux Ubuntu Server 22.04/24.04, Debian 12 o compatible.
- Node.js 20 LTS o superior.
- MariaDB 10.6 o superior.
- Acceso sudo.
- Puerto disponible, por defecto `8080`.

## 2. Preparar sistema

```bash
sudo apt update
sudo apt install -y nodejs npm mariadb-server unzip
sudo systemctl enable --now mariadb
```

Verifique versiones:

```bash
node -v
npm -v
mariadb --version
```

## 3. Crear usuario del sistema

```bash
sudo useradd --system --home /opt/sbseps --shell /usr/sbin/nologin sbseps
sudo mkdir -p /opt/sbseps/app
sudo chown -R sbseps:sbseps /opt/sbseps
```

Copie el proyecto a `/opt/sbseps/app`.

## 4. Crear base MariaDB

Desde la carpeta de la aplicacion:

```bash
sudo mariadb < schema.sql
```

Esto crea:

- Base: `SBSEPS`
- Usuario: `seguridadinf`
- Contrasena: `seguridadinf`
- Tablas principales y permisos suficientes.

## 5. Configurar ambiente

```bash
cp .env.example .env
nano .env
```

Cambie obligatoriamente:

```env
SESSION_SECRET=un-secreto-largo-aleatorio
```

Para produccion con MariaDB:

```env
NODE_ENV=production
PORT=8080
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=SBSEPS
DB_USER=seguridadinf
DB_PASSWORD=seguridadinf
```

## 6. Instalar dependencias

```bash
npm ci --omit=dev
```

Si no existe `package-lock.json`, use:

```bash
npm install --omit=dev
```

## 7. Primer arranque

```bash
npm start
```

La consola debe mostrar conexion a MariaDB y servidor en `http://localhost:8080`.

Credenciales iniciales:

- Usuario: `admin`
- Contrasena: `admin`

Cambie la contrasena inicial desde la aplicacion.

## 8. Instalar como servicio

```bash
sudo cp deploy/sbseps.service.example /etc/systemd/system/sbseps.service
sudo systemctl daemon-reload
sudo systemctl enable --now sbseps
sudo systemctl status sbseps
```

## 9. Errores frecuentes

### Error: puerto ocupado

Sintoma: `EADDRINUSE`.

Solucion:

```bash
sudo ss -ltnp | grep 8080
```

Cambie `PORT` en `.env` o libere el proceso que usa el puerto.

### Error de conexion MariaDB

Sintoma: fallback a SQLite o error de credenciales.

Verifique:

```bash
mariadb -u seguridadinf -pseguridadinf SBSEPS
```

Si falla, ejecute de nuevo:

```bash
sudo mariadb < schema.sql
```

### Error npm install sqlite3

Instale herramientas de compilacion:

```bash
sudo apt install -y build-essential python3 make g++
npm rebuild sqlite3
```

### Captcha o login no persiste

Revise `SESSION_SECRET` y que el navegador acepte cookies. Si usa proxy HTTPS, configure correctamente cabeceras y dominio.

### Archivos no suben

Revise permisos:

```bash
sudo chown -R sbseps:sbseps /opt/sbseps/app/uploads /opt/sbseps/app/updates
```

Revise limites `MAX_UPLOAD_MB` y `MAX_UPDATE_MB`.

## 10. Respaldo

MariaDB:

```bash
mysqldump -u seguridadinf -p SBSEPS > SBSEPS_backup.sql
```

Copie tambien:

- `uploads/`
- `updates/`
- `.env`

## 11. Restauracion

```bash
mariadb -u seguridadinf -p SBSEPS < SBSEPS_backup.sql
```

Luego restaure carpetas `uploads/` y `updates/`.
