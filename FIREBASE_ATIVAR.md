# Ativar o login Google na sincronização

O app já tem o código pronto. Falta um projeto Firebase (gratuito) na sua conta Google.
Leva uns 10 minutos. No fim, você me manda o bloco `firebaseConfig` (passo 4) e eu publico.

## 1. Criar o projeto

1. Entre em https://console.firebase.google.com com a conta Google que vai administrar o app.
2. **Criar um projeto** › nome `mapeador` › pode desligar o Google Analytics › **Criar projeto**.

## 2. Ligar o login Google

1. Menu da esquerda: **Criação › Authentication** › **Vamos começar**.
2. Aba **Método de login** › **Google** › **Ativar** › escolha o e-mail de suporte › **Salvar**.
3. Aba **Configurações** › **Domínios autorizados** › **Adicionar domínio** › `henrique1970-blip.github.io`.

## 3. Criar o banco de dados (Firestore)

1. Menu: **Criação › Firestore Database** › **Criar banco de dados**.
2. Local: `southamerica-east1 (São Paulo)` › **Iniciar no modo de produção** › **Criar**.
3. Aba **Regras**, apague tudo, cole o texto abaixo e clique em **Publicar**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // cada pessoa só lê e grava as próprias medições
    match /users/{uid}/items/{itemId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 4. Registrar o app web e copiar a configuração

1. Engrenagem ⚙ ao lado de "Visão geral do projeto" › **Configurações do projeto**.
2. Em **Seus apps**, clique no ícone **</>** (Web) › apelido `mapeador` › **Registrar app**
   (não precisa marcar o Firebase Hosting).
3. Aparece um bloco `const firebaseConfig = { apiKey: ..., authDomain: ..., projectId: ..., ... }`.
   Copie esse bloco e me envie, ou cole você mesmo em `firebase-config.js` no lugar de `null`:

```js
window.FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "mapeador-xxxx.firebaseapp.com",
  projectId: "mapeador-xxxx",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

Esses valores **não são senha**: identificam o projeto e vão para o navegador de qualquer usuário.
Quem protege os dados são as regras do passo 3.

## Custos

O plano gratuito (Spark) do Firebase cobre 50 mil leituras e 20 mil gravações por dia, muito acima
do uso de uma equipe medindo áreas. Não é preciso cadastrar cartão.

## Depois de ativar

- Testar primeiro no **iPhone instalado na tela inicial**: o login Google em app instalado no iOS às vezes
  abre e fecha a janela sem concluir. Se acontecer, entre pelo Safari normal (sem instalar), que funciona,
  e me avise para eu ajustar.
- Quem já usa o GitHub Gist pode continuar nele. Para trocar: **Desconectar** e entrar com Google;
  as medições do aparelho vão junto para a conta Google.
