# Gastos TI · CGR

Sistema de control de gastos del área de TI. Corre en esta PC con Node.js y un PostgreSQL embebido (no hay que instalar base de datos).

## Uso diario

- **Arrancar:** doble clic en `INICIAR.bat`. Abre http://localhost:3000 y deja una ventana "Gastos TI - servidor" que debe permanecer abierta.
- **Detener:** doble clic en `DETENER.bat` (o cierra esa ventana).
- **Desde otra PC de la red:** http://<IP-de-esta-PC>:3000 (la IP se ve con `ipconfig`; si no entra, permite el puerto 3000 en el Firewall de Windows).
- **Arranque automático:** Programador de tareas › Crear tarea básica › "Al iniciar sesión" › Iniciar un programa: `C:\Users\Martinez\Desktop\TI gastos\INICIAR.bat`.
- Si algo falla, `servidor.log` tiene el detalle del último arranque.

## Qué hace

- **Registro de gastos** con fecha, proveedor (lista con alta rápida), categoría, concepto, subtotal, IVA 16 % automático y estado de pago.
- **Carga de la factura para llenar el formulario**: sube el XML del CFDI (datos exactos: fecha, emisor, RFC, concepto, subtotal, IVA, folio, UUID) o el PDF (se leen montos, folio y RFC; conviene revisar). La factura queda adjunta en el expediente al guardar. Si el proveedor ya existe (por RFC o nombre) se selecciona solo y se propone su categoría habitual.
- **Proveedores**: lista administrable en la pestaña Presupuesto (nombre, RFC, categoría habitual, gastos y total).
- **Expediente por gasto**: cotización → orden de compra → factura → albarán. Cada etapa guarda uno o más PDF con folio y fecha. Los PDF quedan en `uploads\` y su referencia en la base.
- **Tablero de KPIs**: gastado del mes, acumulado del año, presupuesto y disponible, comparación contra prorrateo, promedio mensual, pendiente de pago; **qué mes ha costado más y por qué**; gasto mensual contra presupuesto; acumulado por categoría y proveedor; estado de los expedientes.
- **Línea de tiempo** de altas, documentos, pagos y cambios, por año o por mes.
- **Presupuesto anual por categoría** y administración de categorías.
- **Exportación a CSV** del año (abre en Excel).

## Carpetas y archivos

```
INICIAR.bat        arranca todo (instala dependencias si faltan)
DETENER.bat        apaga el servidor
.env               configuración (puerto, carpeta de PDF, base de datos)
.env.example       plantilla que usa INICIAR.bat para crear .env
server\            API (index.js), conexión (db.js) y PostgreSQL embebido (embedded.js)
db\schema.sql      tablas, índices y categorías iniciales; se aplica solo en cada arranque
public\            interfaz web
pgdata\            datos de PostgreSQL (NO borrar: aquí viven los gastos)
uploads\           PDF de los expedientes (NO borrar)
node_modules\      dependencias instaladas por npm
servidor.log       bitácora del servidor
```

## Respaldo

Copia las carpetas `pgdata\` y `uploads\` con el servidor detenido (`DETENER.bat` primero). Para restaurar, vuelve a ponerlas en su lugar y arranca.

## Configuración (.env)

| Variable | Uso | Valor por defecto |
|---|---|---|
| `PORT` | Puerto de la app | `3000` |
| `UPLOAD_DIR` | Carpeta de los PDF | `./uploads` |
| `MAX_PDF_MB` | Tamaño máximo por PDF | `25` |
| `DATABASE_URL` | Vacía = PostgreSQL embebido. Para usar un PostgreSQL propio: `postgres://usuario:clave@servidor:5432/gastos_ti` | (vacía) |
| `PGDATA_DIR` | Carpeta de datos del PostgreSQL embebido | `./pgdata` |
| `EMBEDDED_PG_PORT` | Puerto del PostgreSQL embebido | `5433` |

Tablas: `categorias`, `proveedores`, `gastos`, `presupuestos`, `documentos` (expediente) y `eventos` (línea de tiempo); vista `v_gastos`.

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/gastos?anio=&mes=&categoria_id=&estado=&q=` | Lista de gastos con el avance del expediente |
| GET | `/api/gastos/:id` | Gasto con sus documentos y su historial |
| POST / PUT / DELETE | `/api/gastos`, `/api/gastos/:id` | Alta, edición y borrado (borra también sus PDF) |
| POST | `/api/gastos/:id/pagar` | Marca como pagado |
| POST | `/api/gastos/:id/documentos` | Sube un PDF (`multipart/form-data`: `tipo`, `folio`, `fecha`, `archivo`) |
| GET | `/api/documentos/:id/archivo` | Abre el PDF (`?descargar=1` para descargar) |
| DELETE | `/api/documentos/:id` | Elimina un PDF del expediente |
| GET / PUT | `/api/presupuestos/:anio` | Presupuesto anual por categoría |
| GET / POST / DELETE | `/api/categorias` | Categorías |
| GET | `/api/kpis?anio=` | Indicadores del año, mes más caro y razones |
| GET | `/api/timeline?anio=&mes=` | Línea de tiempo |
| GET | `/api/export.csv?anio=` | Exportación CSV |

## Seguridad

No tiene usuarios ni contraseña: está pensada para la red interna de TI. Si va a quedar accesible fuera de esa red, ponla detrás de un proxy con autenticación o VPN.
