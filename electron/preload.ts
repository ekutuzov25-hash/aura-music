/**
 * Exposes only the platform name to the page, so the UI can leave room for
 * the macOS window buttons. No Node APIs reach the web content.
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('auraDesktop', { platform: process.platform });
