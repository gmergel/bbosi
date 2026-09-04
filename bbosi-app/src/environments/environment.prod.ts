const proxyBaseUrl = 'https://bbosi-proxy.bbosi-proxy.workers.dev';

export const environment = {
  production: true,
  yahooBaseUrl: `${proxyBaseUrl}/api/yahoo`,
  opcoesBaseUrl: `${proxyBaseUrl}/api/opcoes`,
  vendacobertaBaseUrl: `${proxyBaseUrl}/api/vendacoberta`,
  yahooBaseUrls: [`${proxyBaseUrl}/api/yahoo`],
  opcoesBaseUrls: [`${proxyBaseUrl}/api/opcoes`],
  vendacobertaBaseUrls: [`${proxyBaseUrl}/api/vendacoberta`],
};
