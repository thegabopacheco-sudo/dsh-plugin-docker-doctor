# dsh-plugin-docker-doctor — Docker Doctor

Audita Dockerfile y docker-compose de un proyecto: imagen sin pin, root, ADD, secretos en ENV/ARG, descargas ejecutadas y falta de healthcheck, sin construir nada.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `scan` | Auditar Docker |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-docker-doctor` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-docker-doctor
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_DOCKER_DOCTOR_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\docker-doctor\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
