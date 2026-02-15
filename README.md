# Numo Admin

Painel simples em HTML/JS para interagir com o ecossistema Numo:
- Ver health de NumoCore e NumoDirectory.
- Listar e criar participantes.
- Enviar pagamentos via NumoCore.
- Consultar saldos.

## Uso
1. Suba os serviços (ex.: `numoCore/docker-compose.yml`, `numoKeys/docker-compose.yml`, `numoLedger/docker-compose.yml` e `numoAdmin/docker-compose.yml`).
2. Acesse http://localhost:4173 (servido pelo backend Node com Basic Auth opcional).
3. Ajuste Config com URLs de Core/Directory/Keys/Ledger e rode Health.

### Funcionalidades (páginas)
- `config.html`: configura URLs de Core/Directory/Keys e salva em localStorage.
- `health.html`: health dos serviços.
- `participants.html`: CRUD completo (status/permissões) e criação de conta.
- `accounts.html`: consulta/criação de contas.
- `keys.html`: registrar, resolver, portar, deletar chaves.
- `payments.html`: transferências entre participantes.
- `pay-key.html`: resolve key e transfere para o participante destino.
- `ledger.html`: consulta lançamentos com filtros/paginação, saldo e snapshots.
- `audit.html`: mostra ações registradas localmente.
- `trust.html`: administrar a CA do NumoTrust (health/CA, emitir certs client/server, rotacionar CA).
- `signin.html` / `profile.html`: login e perfil do usuário (autenticação via sessão + Postgres).

### Observações
- Backend Node (`npm start` ou docker compose) serve os estáticos e pode exigir Basic Auth via `ADMIN_USER`/`ADMIN_PASS`.
- Auditoria centralizada no backend em `/api/audit` (persistida em `audit-log.json`, com fallback localStorage).
- Armazena configurações no backend (`/api/config`, arquivo `internal/config.json`) e replica no `localStorage` do navegador.
- UI em layout TailAdmin-like servida localmente (assets em `assets/tailadmin/`, sem dependência de CDN) com sidebar e topo, acessível a partir de `/config.html` (ou `/` via redirect).
- Autenticação por sessão + Postgres (`ADMIN_DB_URL`) com usuário seed `numoAdmin/numoAdmin`; páginas protegidas redirecionam para `signin.html`.
- Auth: se `ADMIN_JWT_SECRET` estiver definido, o backend exige Bearer JWT HS256. Se não, usa Basic Auth (`ADMIN_USER`/`ADMIN_PASS`) ou aberto.
- TLS opcional via `TLS_CERT`/`TLS_KEY`.
- Proxy opcional `/api/proxy` para chamadas a serviços com injeção de JWT (`UPSTREAM_JWT`) e mTLS (`CLIENT_CERT`/`CLIENT_KEY`/`TLS_CA`), limitado por `PROXY_ALLOW_HOSTS`.

## Servindo em uma porta
- Via Node/http-server:
  ```bash
  cd numoAdmin
  npm install
  npm run start
  ```
  Acesse em http://localhost:4173

- Via Docker:
  ```bash
  cd numoAdmin
  docker compose up --build
  ```
  Acesse em http://localhost:4173
