// Visualizar (pré-visualização nativa de impressão) e compartilhar o PDF
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildPrintHtml } from './printHtml';

/** Abre a visualização do PDF (sem baixar). No celular é a tela nativa de impressão/prévia. */
export async function viewPdf(opts) {
  const html = buildPrintHtml(opts);
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    return;
  }
  await Print.printAsync({ html });
}

/** Gera o arquivo PDF e abre o menu de compartilhar (WhatsApp, Arquivos, e-mail…). */
export async function sharePdf(opts, filename = 'cifras') {
  const html = buildPrintHtml(opts);
  if (Platform.OS === 'web') return viewPdf(opts);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: filename });
  }
}
