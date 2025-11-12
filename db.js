// IndexedDB wrapper for storing custom emoji images as Blobs
const DB_NAME = 'EmojiOverlayDB';
const DB_VERSION = 1;
const STORE_NAME = 'images';

/**
 * Initialize the IndexedDB database
 * @returns {Promise<IDBDatabase>} The initialized database
 */
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB: ' + request.error));
    };
    
    request.onsuccess = () => {
      resolve(request.result);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * Save an image Blob to IndexedDB
 * @param {Blob} blob - The image Blob to store
 * @param {string} id - Unique identifier for the image
 * @returns {Promise<void>}
 */
async function saveImage(blob, id) {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    
    const imageData = {
      id: id,
      blob: blob,
      timestamp: Date.now()
    };
    
    const request = objectStore.put(imageData);
    
    request.onsuccess = () => {
      resolve();
    };
    
    request.onerror = () => {
      reject(new Error('Failed to save image: ' + request.error));
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get all images from IndexedDB
 * @returns {Promise<Array<{id: string, blob: Blob, objectURL: string}>>}
 */
async function getAllImages() {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.getAll();
    
    request.onsuccess = () => {
      const images = request.result.map(item => ({
        id: item.id,
        blob: item.blob,
        objectURL: URL.createObjectURL(item.blob)
      }));
      resolve(images);
    };
    
    request.onerror = () => {
      reject(new Error('Failed to get images: ' + request.error));
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Delete a specific image from IndexedDB
 * @param {string} id - The ID of the image to delete
 * @returns {Promise<void>}
 */
async function deleteImage(id) {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.delete(id);
    
    request.onsuccess = () => {
      resolve();
    };
    
    request.onerror = () => {
      reject(new Error('Failed to delete image: ' + request.error));
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Clear all images from IndexedDB
 * @returns {Promise<void>}
 */
async function clearAllImages() {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.clear();
    
    request.onsuccess = () => {
      resolve();
    };
    
    request.onerror = () => {
      reject(new Error('Failed to clear images: ' + request.error));
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get a single image by ID
 * @param {string} id - The ID of the image to retrieve
 * @returns {Promise<{id: string, blob: Blob, objectURL: string} | null>}
 */
async function getImage(id) {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.get(id);
    
    request.onsuccess = () => {
      if (request.result) {
        resolve({
          id: request.result.id,
          blob: request.result.blob,
          objectURL: URL.createObjectURL(request.result.blob)
        });
      } else {
        resolve(null);
      }
    };
    
    request.onerror = () => {
      reject(new Error('Failed to get image: ' + request.error));
    };
    
    transaction.oncomplete = () => {
      db.close();
    };
  });
}

