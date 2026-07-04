export interface SecurityResult {
  ok: boolean;
  reason?: string;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const ALLOWED_EXT = new Set([
  '.pdf',
  '.json',
  '.csv',
  '.xlsx',
  '.xls',
  '.docx',
  '.doc',
  '.txt',
]);

// Binary magic-byte signatures
const MAGIC: Record<string, number[]> = {
  '.pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
  '.xlsx': [0x50, 0x4b, 0x03, 0x04], // PK (ZIP/OOXML)
  '.docx': [0x50, 0x4b, 0x03, 0x04], // PK (ZIP/OOXML)
  '.xls': [0xd0, 0xcf, 0x11, 0xe0], // OLE2
  '.doc': [0xd0, 0xcf, 0x11, 0xe0], // OLE2
};

// Patterns that must never appear in text-based files
const DANGEROUS_PATTERNS: RegExp[] = [
  // Script / code injection
  /<script[\s>]/i,
  /javascript\s*:/i,
  /\beval\s*\(/i,
  /\bexec\s*\(/i,
  /\bFunction\s*\(/i,
  /on\w+\s*=/i, // event handlers (onerror=, onload=, …)
  // Shell
  /\$\([^)]+\)/,
  /`[^`]+`/,
  // SQL injection (most common verbs)
  /\bDROP\s+(TABLE|DATABASE|INDEX)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUNION\s+(ALL\s+)?SELECT\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bCREATE\s+(OR\s+REPLACE\s+)?TABLE\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bEXEC(\s+|\()/i,
  /\bxp_cmdshell\b/i,
  /--\s*$|;\s*--/m, // SQL comment terminator
  // Path traversal
  /\.\.[/\\]/,
];

const TEXT_EXTS = new Set(['.txt', '.csv', '.json']);

export function validateUpload(filename: string, buf: Buffer): SecurityResult {
  // 1 — size
  if (buf.length > MAX_FILE_SIZE) {
    return { ok: false, reason: 'File exceeds the 25 MB limit.' };
  }

  // 2 — extension whitelist
  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
  if (!ALLOWED_EXT.has(ext)) {
    return {
      ok: false,
      reason: `File type "${ext || 'unknown'}" is not permitted.`,
    };
  }

  // 3 — null-byte check (polyglot / exploit indicator in text files)
  if (TEXT_EXTS.has(ext) && buf.indexOf(0x00) !== -1) {
    return { ok: false, reason: 'File contains unexpected binary data.' };
  }

  // 4 — magic-byte validation for binary formats
  const magic = MAGIC[ext];
  if (magic) {
    for (let i = 0; i < magic.length; i++) {
      if (buf[i] !== magic[i]) {
        return {
          ok: false,
          reason: 'File header does not match the declared format.',
        };
      }
    }
  }

  // 5 — embedded-executable guard (PE/ELF/Mach-O inside any file)
  if (
    (buf[0] === 0x4d && buf[1] === 0x5a) || // MZ — Windows PE
    (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) // ELF
  ) {
    return {
      ok: false,
      reason: 'File appears to contain executable code.',
    };
  }

  // 6 — content scanning for text-based formats
  if (TEXT_EXTS.has(ext)) {
    const text = buf.toString('utf8');

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(text)) {
        return {
          ok: false,
          reason:
            'File contains potentially malicious content and was rejected.',
        };
      }
    }

    // CSV formula injection: any cell starting with = + - @ \t \r
    if (ext === '.csv') {
      for (const line of text.split('\n')) {
        for (const cell of line.split(',')) {
          const v = cell.trim().replace(/^["']/, '');
          if (/^[=+\-@\t\r]/.test(v)) {
            return {
              ok: false,
              reason:
                'CSV file contains formula injection in one or more cells.',
            };
          }
        }
      }
    }

    // JSON must be valid
    if (ext === '.json') {
      try {
        JSON.parse(text);
      } catch {
        return { ok: false, reason: 'JSON file is malformed.' };
      }
    }
  }

  return { ok: true };
}
