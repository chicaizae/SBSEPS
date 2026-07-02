# Manual de Instalacion Paso a Paso - SBSEPS

Esta guia explica como instalar la aplicacion SBSEPS desde GitHub de una forma sencilla. Siga los pasos en orden y copie los comandos tal como aparecen.

## 1. Que necesita antes de empezar

- Un servidor Linux Ubuntu 22.04/24.04, Debian 12 o similar.
- Acceso a una cuenta con permisos `sudo`.
- Conexion a internet.
- Puerto `8080` disponible.
- Node.js 20.17.0 o superior.
- La direccion del repositorio:

```bash
https://github.com/chicaizae/SBSEPS.git
```

## 2. Instalar programas necesarios

Entre al servidor por terminal y ejecute:

```bash
sudo apt update
sudo apt install -y git nodejs npm mariadb-server unzip
```

Si `node -v` muestra una version menor a `v20.17.0`, instale Node.js 20 LTS actualizado antes de continuar.

Active MariaDB:

```bash
sudo systemctl enable --now mariadb
```

Verifique que todo quedo instalado:

```bash
git --version
node -v
npm -v
mariadb --version
```

## 3. Descargar la aplicacion desde GitHub

Cree una carpeta para la aplicacion:

```bash
sudo mkdir -p /opt/sbseps
sudo chown -R $USER:$USER /opt/sbseps
cd /opt/sbseps
```

Clone el repositorio:

```bash
git clone https://github.com/chicaizae/SBSEPS.git app
cd app
```

## 4. Crear la base de datos

Desde la carpeta `/opt/sbseps/app`, ejecute:

```bash
sudo mariadb < schema.sql
```

Este comando crea automaticamente:

- Base de datos: `SBSEPS`
- Usuario: `seguridadinf`
- Contrasena: `seguridadinf`
- Tablas necesarias del sistema

## 5. Crear el archivo de configuracion

Copie el archivo de ejemplo:

```bash
cp .env.example .env
```

Abra el archivo:

```bash
nano .env
```

Revise que tenga estos valores:

```env
NODE_ENV=production
PORT=8080

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=SBSEPS
DB_USER=seguridadinf
DB_PASSWORD=seguridadinf

SESSION_SECRET=cambie-este-secreto-largo-y-aleatorio
```

Muy importante: cambie `SESSION_SECRET` por una frase larga y dificil de adivinar. Ejemplo:

```env
SESSION_SECRET=mi-empresa-sbseps-2026-secreto-super-largo
```

Guarde con `Ctrl + O`, presione `Enter` y salga con `Ctrl + X`.

## 6. Instalar dependencias de la aplicacion

Ejecute:

```bash
npm ci --omit=dev
```

Si aparece un error indicando que no existe `package-lock.json`, use:

```bash
npm install --omit=dev
```

## 7. Probar que funciona

Arranque la aplicacion:

```bash
npm start
```

Debe ver un mensaje parecido a:

```text
Server is running locally at http://localhost:8080
Database mode: mariadb
```

Abra en el navegador:

```text
http://IP-DEL-SERVIDOR:8080
```

Si el navegador o Sophos bloquea la pagina por ser insegura, no use `https://IP:8080`. La aplicacion en el puerto `8080` sirve HTTP. Para produccion use un dominio con HTTPS y Nginx como proxy inverso.

Credenciales iniciales:

- Usuario: `admin`
- Contrasena: `admin`

Al ingresar, cambie la contrasena inicial.

Para detener la prueba en la terminal, presione:

```text
Ctrl + C
```

## 8. Personalizar la instalacion

Ingrese con el usuario administrador y vaya a:

```text
Personalizacion
```

Configure:

- Nombre de la empresa
- Representante legal
- Logo institucional

Estos datos se reflejan en las pantallas, cabeceras, reportes y firmas.

## 8.1. Ver los controles cargados

Los controles no aparecen como una pantalla independiente al iniciar. Primero debe crear o abrir una auditoria.

Para crear la primera auditoria:

1. Ingrese como `admin` o como usuario `auditor`.
2. En la pantalla inicial, complete empresa, auditor y fecha.
3. Presione `Iniciar desde Plantilla`.
4. Entre a `Evaluacion Activa`.

Alli se mostraran los controles cargados desde la base.

Si ya esta dentro del sistema, los controles se muestran en `Evaluacion Activa`. Si no aparecen, cierre sesion y vuelva a ingresar; cuando no exista una auditoria guardada, el sistema cargara automaticamente la plantilla de controles.

## 9. Dejar la aplicacion como servicio

Esto permite que SBSEPS inicie automaticamente cuando el servidor se reinicie.

Primero cree el usuario del servicio:

```bash
sudo useradd --system --home /opt/sbseps --shell /usr/sbin/nologin sbseps
sudo chown -R sbseps:sbseps /opt/sbseps
```

Instale el servicio:

```bash
sudo cp deploy/sbseps.service.example /etc/systemd/system/sbseps.service
sudo systemctl daemon-reload
sudo systemctl enable --now sbseps
```

Revise el estado:

```bash
sudo systemctl status sbseps
```

Si aparece `active (running)`, la instalacion quedo lista.

## 10. Comandos utiles

Ver estado:

```bash
sudo systemctl status sbseps
```

Reiniciar:

```bash
sudo systemctl restart sbseps
```

Detener:

```bash
sudo systemctl stop sbseps
```

Ver errores en vivo:

```bash
sudo journalctl -u sbseps -f
```

## 10.1. Publicar con HTTPS para evitar bloqueos de seguridad

Para produccion, lo recomendado es:

```text
https://su-dominio.com -> Nginx con SSL -> http://localhost:8080
```

Instale Nginx y Certbot:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Cree el archivo:

```bash
sudo nano /etc/nginx/sites-available/sbseps
```

Contenido de ejemplo:

```nginx
server {
    listen 80;
    server_name su-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Active el sitio:

```bash
sudo ln -s /etc/nginx/sites-available/sbseps /etc/nginx/sites-enabled/sbseps
sudo nginx -t
sudo systemctl reload nginx
```

Emita el certificado:

```bash
sudo certbot --nginx -d su-dominio.com
```

Cuando ya use HTTPS con dominio, puede dejar en `.env`:

```env
NODE_ENV=production
```

Si entra directo por `http://IP:8080`, use:

```env
NODE_ENV=development
```

Esto evita problemas con captcha y cookies seguras mientras no exista HTTPS.

## 11. Actualizar la aplicacion desde GitHub

Entre a la carpeta:

```bash
cd /opt/sbseps/app
```

Descargue cambios:

```bash
git pull
```

Actualice dependencias:

```bash
npm ci --omit=dev
```

Reinicie el servicio:

```bash
sudo systemctl restart sbseps
```

## 12. Respaldo

Respaldar la base MariaDB:

```bash
mysqldump -u seguridadinf -p SBSEPS > SBSEPS_backup.sql
```

Tambien copie estas carpetas y archivos:

- `.env`
- `uploads/`
- `updates/`

## 13. Restaurar respaldo

Restaurar base:

```bash
mariadb -u seguridadinf -p SBSEPS < SBSEPS_backup.sql
```

Luego copie nuevamente:

- `.env`
- `uploads/`
- `updates/`

Finalmente reinicie:

```bash
sudo systemctl restart sbseps
```

## 14. Solucion de problemas

### No abre la pagina

Revise que el servicio este activo:

```bash
sudo systemctl status sbseps
```

Revise errores:

```bash
sudo journalctl -u sbseps -n 80
```

### El puerto 8080 esta ocupado

Busque quien usa el puerto:

```bash
sudo ss -ltnp | grep 8080
```

Puede cambiar el puerto en `.env`:

```env
PORT=8081
```

Luego reinicie:

```bash
sudo systemctl restart sbseps
```

### Error de conexion a MariaDB

Pruebe la conexion:

```bash
mariadb -u seguridadinf -pseguridadinf SBSEPS
```

Si no conecta, vuelva a crear la base:

```bash
sudo mariadb < schema.sql
sudo systemctl restart sbseps
```

### Error instalando sqlite3

Verifique primero que Node sea `v20.17.0` o superior:

```bash
node -v
```

Instale herramientas de compilacion:

```bash
sudo apt install -y build-essential python3 make g++
npm rebuild sqlite3
```

### Mensaje: packages are looking for funding

Este mensaje es informativo de npm. No es un error y no impide que la aplicacion funcione:

```text
packages are looking for funding
```

### Mensaje: vulnerabilidad en xlsx

`npm audit` puede reportar una vulnerabilidad alta en `xlsx`. Actualmente no existe correccion directa publicada para esa libreria. En esta aplicacion el Excel se usa solo para la plantilla local incluida en el servidor y para exportacion, no para aceptar archivos Excel libres desde usuarios.

Mantenga el servidor protegido con HTTPS, firewall y acceso solo a usuarios autorizados.

### No se suben archivos o logo

Revise permisos:

```bash
sudo chown -R sbseps:sbseps /opt/sbseps/app/uploads /opt/sbseps/app/updates
```

Revise los limites en `.env`:

```env
MAX_UPLOAD_MB=25
MAX_UPDATE_MB=100
MAX_LOGO_MB=5
```

## 15. Instalacion rapida para pruebas sin MariaDB

Si solo quiere probar la aplicacion en una computadora o servidor temporal:

```bash
git clone https://github.com/chicaizae/SBSEPS.git
cd SBSEPS
cp .env.example .env
```

Abra `.env` y borre o comente esta linea:

```env
DB_HOST=127.0.0.1
```

Instale y arranque:

```bash
npm ci
npm start
```

La aplicacion creara una base local llamada `SBSEPS.db`.
