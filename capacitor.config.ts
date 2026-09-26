import type { CapacitorConfig } from '@capacitor/cli';

/**
 * O app de celular é uma "casca" que abre o site publicado (Vercel).
 * O jogo depende das rotas /api, do banco e da IA no servidor — por isso
 * não dá para empacotar um export estático: o WebView carrega a URL real.
 *
 * Defina a URL ao sincronizar:  CAP_SERVER_URL=https://seu-jogo.vercel.app npx cap sync
 */
const serverUrl = process.env.CAP_SERVER_URL || 'https://SEU-JOGO.vercel.app';

const config: CapacitorConfig = {
  appId: 'com.linha.sobrevivencia',
  appName: 'Linha de Sobrevivência',
  // Tela reserva empacotada no app (aparece só se a URL não carregar).
  webDir: 'mobile/www',
  backgroundColor: '#07050a',
  server: {
    url: serverUrl,
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#07050a',
  },
  ios: {
    backgroundColor: '#07050a',
    contentInset: 'always',
  },
};

export default config;
