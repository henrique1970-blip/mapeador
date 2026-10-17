# Mapeador de Áreas

Aplicativo web instalável (PWA) para medir área, distância e pontos sobre imagem de satélite,
tocando no mapa ou caminhando com o GPS. Um código só roda em iPhone, Android e PC.

## O que faz

- **Área**: hectares, m², km², alqueire paulista (24.200 m²), alqueire mineiro/goiano (48.400 m²), acres; perímetro.
- **Distância**: comprimento de trajetos (m, km, milhas, pés), com o comprimento de cada trecho no mapa.
- **Ponto**: coordenada em graus decimais e UTM (SIRGAS 2000 / WGS84, mesma coisa para efeito prático).
- **Marcação manual** (tocar no mapa) ou **por GPS** (caminhando; marca um vértice a cada N metros
  quando a precisão está dentro do limite; mantém a tela acesa).
- Arrastar vértice, inserir vértice no meio de um lado, apagar vértice, desfazer (Ctrl+Z / Delete no PC).
- Salvar com nome, grupo, cor e observações; lista com busca, filtro por grupo e área total.
- Exportar KML, GeoJSON ou CSV (baixar ou compartilhar); importar KML e GeoJSON.
- Camadas: satélite com nomes, satélite, ruas (OSM), topográfico (OpenTopoMap). Busca por lugar ou "lat, lon".
- **Offline**: o app abre e mede sem internet depois da primeira abertura. O mapa de satélite da área na tela
  pode ser baixado antes (◩ › Mapa offline, até 4.000 blocos por vez); o resto do mapa guarda o que já foi visto.
- **Sincronização entre aparelhos** (☰ › Sincronizar): GitHub Gist (token pessoal com permissão `gist`) já
  funciona; login Google fica disponível depois de ativar o Firebase (`FIREBASE_ATIVAR.md`). Vence a alteração
  mais recente de cada medição; exclusões se propagam.
- **Manual do usuário**: `manual.html` e `manual.pdf` (links na lista ☰; também abrem offline). O PDF é gerado do HTML pelo Chrome (impressão A4).

Cálculo geodésico no elipsoide WGS84 (`geo.js`), conferido contra o pyproj: diferença de área
abaixo de 0,00002 %, perímetro e UTM idênticos ao milímetro.

## Arquivos

`index.html`, `style.css`, `app.js` (interface), `geo.js` (cálculo), `formats.js` (KML/GeoJSON/CSV),
`offline.js` (download de mapa), `sync.js` (sincronização), `firebase-config.js` (login Google, `null` até ativar),
`sw.js` (offline), `manual.html`, `manual.pdf`, `manifest.webmanifest` e `icons/` (instalação).

## Testar no PC

```
python -m http.server 8765 --bind 127.0.0.1
```
e abrir http://127.0.0.1:8765

## Publicar (necessário para usar no celular)

O GPS dos navegadores só funciona em **HTTPS**. Basta hospedar esta pasta em qualquer site
estático: GitHub Pages, Netlify, Cloudflare Pages ou o próprio servidor da empresa com HTTPS.

## Instalar

- **iPhone (Safari)**: abrir o endereço › Compartilhar › "Adicionar à Tela de Início".
- **Android (Chrome)**: abrir o endereço › menu ⋮ › "Instalar app".
- **PC (Chrome/Edge)**: ícone de instalar na barra de endereço.

## Limitações

- Sem sincronização ligada, as medições ficam só no aparelho/navegador. Use "Exportar tudo" como cópia de segurança.
- Conflito de edição é resolvido pelo relógio do aparelho (vence a mais recente); relógio errado decide errado.
- Download em lote só das camadas de satélite (Esri). OSM e OpenTopoMap proíbem download em lote nas regras de uso.
- No iPhone, a gravação por GPS para se a tela for bloqueada; o app pede para manter a tela acesa.
- KMZ não é importado (descompacte e importe o KML).
