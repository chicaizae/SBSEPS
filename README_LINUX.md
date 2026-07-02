# SBSEPS Due Diligence v1.0

Aplicacion web para evaluacion de Due Diligence de Seguridad de la Informacion SB/SEPS.

## Valores por defecto

- Base de datos MariaDB: `SBSEPS`
- Usuario BBDD: `seguridadinf`
- Contrasena BBDD: `seguridadinf`
- Usuario inicial app: `admin`
- Contrasena inicial app: `admin`

## Archivos importantes

- `.env.example`: parametros de configuracion.
- `schema.sql`: estructura MariaDB y permisos.
- `deploy/sbseps.service.example`: ejemplo de servicio Linux systemd.
- `docs/MANUAL_INSTALACION.md`: instalacion paso a paso y solucion de errores.
- `docs/MANUAL_TECNICO.md`: arquitectura, BBDD, seguridad y actualizaciones.
- `docs/MANUAL_USUARIO.md`: uso operativo por perfiles.

## Arranque rapido en Linux

```bash
sudo mariadb < schema.sql
cp .env.example .env
npm ci --omit=dev
npm start
```

Si no se define `DB_HOST`, la aplicacion crea una base SQLite local `SBSEPS.db`, util para pruebas.

## Actualizaciones

La version 1.0 incluye una pestaña de administrador llamada `Actualizaciones`.
Permite registrar o subir paquetes `.zip`, `.sql`, `.json`, `.md` o `.txt` sin sobrescribir la version instalada.
Los paquetes quedan en la carpeta `updates/` y se registran en la tabla `update_packages` con checksum SHA-256.
