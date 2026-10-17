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
- Funciona sem internet depois da primeira abertura; o mapa offline cobre só as regiões já visualizadas.

Cálculo geodésico no elipsoide WGS84 (`geo.js`), conferido contra o pyproj: diferença de área
abaixo de 0,00002 %, perímetro e UTM idênticos ao milímetro.

## Arquivos

`index.html`, `style.css`, `app.js` (interface), `geo.js` (cálculo), `formats.js` (KML/GeoJSON/CSV),
`sw.js` (offline), `manifest.webmanifest` e `icons/` (instalação).

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

- As medições ficam guardadas no aparelho/navegador (não sincronizam entre aparelhos). Use
  "Exportar tudo" como cópia de segurança.
- No iPhone, a gravação por GPS para se a tela for bloqueada; o app pede para manter a tela acesa.
- KMZ não é importado (descompacte e importe o KML).
