export type FileRef = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  path: string;
};

export type AttachmentPlan = {
  attach: FileRef[];
  tooLarge: FileRef[];
};

// Total attachment bytes per email. Stays under Mailgun's 25 MB and Brevo's
// lower limit, with headroom for base64 expansion.
export const MAX_ATTACH_MB_DEFAULT = 10;

/**
 * Decide which files fit the budget. Smallest first, so one large file cannot
 * crowd out several small ones. Files that do not fit are RETURNED, not dropped —
 * the caller names them in the email alongside their download links.
 */
export function planAttachments(files: FileRef[], budgetBytes: number): AttachmentPlan {
  const attach: FileRef[] = [];
  const tooLarge: FileRef[] = [];
  let used = 0;

  for (const file of [...(files || [])].sort((a, b) => a.size - b.size)) {
    if (used + file.size <= budgetBytes) {
      attach.push(file);
      used += file.size;
    } else {
      tooLarge.push(file);
    }
  }

  return { attach, tooLarge };
}
