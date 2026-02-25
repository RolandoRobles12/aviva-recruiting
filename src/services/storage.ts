import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '../lib/firebase';
import type { DocumentType } from '../types';

export interface UploadProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
}

export async function uploadDocument(
  candidateId: string,
  documentType: DocumentType,
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<{ storagePath: string; downloadUrl: string }> {
  const extension = file.name.split('.').pop();
  const storagePath = `candidates/${candidateId}/documents/${documentType}.${extension}`;
  const storageRef = ref(storage, storagePath);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
      customMetadata: {
        candidateId,
        documentType,
        originalName: file.name,
      },
    });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const percentage = Math.round(
          (snapshot.bytesTransferred / snapshot.totalBytes) * 100
        );
        onProgress?.({
          bytesTransferred: snapshot.bytesTransferred,
          totalBytes: snapshot.totalBytes,
          percentage,
        });
      },
      (error) => reject(error),
      async () => {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        resolve({ storagePath, downloadUrl });
      }
    );
  });
}

export async function deleteDocument(storagePath: string): Promise<void> {
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
}
