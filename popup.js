// Global variable to temporarily store the selected file for naming
let pendingFile = null;

// Initialize on popup load
document.addEventListener('DOMContentLoaded', () => {
  loadCustomImages();
  loadSelectedAnimation();
  setupEventListeners();
  setupModalListeners();
});

// ===== API KEY MANAGEMENT =====

async function getApiKey() {
  const data = await chrome.storage.local.get('openaiApiKey');
  return data.openaiApiKey || null;
}

async function saveApiKey(key) {
  await chrome.storage.local.set({ openaiApiKey: key });
}

function validateApiKey(key) {
  // Basic validation: OpenAI keys start with 'sk-' and have reasonable length
  if (!key || typeof key !== 'string') {
    return false;
  }
  const trimmedKey = key.trim();
  return trimmedKey.startsWith('sk-') && trimmedKey.length > 20;
}

// ===== OPENAI API INTEGRATION =====

async function generateImageWithOpenAI(prompt, apiKey) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: prompt,
      size: '1024x1024',
      quality: 'medium',
      n: 1
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('OpenAI API Error:', errorData);
    throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
  }

  const data = await response.json();
  console.log('OpenAI API Response:', data);
  
  if (!data.data || !data.data[0]) {
    console.error('Unexpected API response structure:', data);
    throw new Error('Invalid response from OpenAI API: ' + JSON.stringify(data).substring(0, 200));
  }

  // Handle both URL and base64 formats
  const imageData = data.data[0];
  if (imageData.url) {
    return imageData.url;
  } else if (imageData.b64_json) {
    // Convert base64 to data URL
    return `data:image/png;base64,${imageData.b64_json}`;
  } else {
    throw new Error('No image URL or base64 data in response');
  }
}

async function downloadImageAsBlob(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to download generated image');
  }
  return await response.blob();
}

function setupEventListeners() {
  // Search input handler
  const searchInput = document.getElementById('emojiSearch');
  if (searchInput) {
    searchInput.addEventListener('input', filterEmojis);
  }
  
  // Menu toggle handlers
  document.querySelectorAll('.menu-item-header').forEach(header => {
    header.addEventListener('click', (e) => {
      const menuItem = header.parentElement;
      const wasOpen = menuItem.classList.contains('open');
      
      // Close all menus
      document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('open');
      });
      
      // Toggle this menu
      if (!wasOpen) {
        menuItem.classList.add('open');
      }
    });
  });
  
  // Emoji button handlers
  document.querySelectorAll(".emoji-grid button").forEach(button => {
    // Skip the add and clear buttons, they have their own handlers
    if (button.id === 'addCustomBtn' || button.id === 'clearBtn') return;
    
    button.addEventListener("click", async () => {
      const type = button.dataset.type;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Get selected animation
      const data = await chrome.storage.local.get('selectedAnimation');
      const animationType = data.selectedAnimation || 'burst';

      if (type === "emoji") {
        const emoji = button.dataset.value;
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showEmojiOverlay,
          args: [emoji, animationType]
        });
      } else if (type === "image") {
        let src = button.dataset.src;
        // If it's not a data URL, convert to chrome extension URL
        if (!src.startsWith('data:')) {
          src = chrome.runtime.getURL(src);
        }
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showImageOverlay,
          args: [src, animationType]
        });
      }
    });
  });
  
  // Add custom image button handler
  document.getElementById('addCustomBtn').addEventListener('click', handleAddCustomImage);
  
  // Clear custom images button handler
  document.getElementById('clearBtn').addEventListener('click', handleClearCustomImages);
  
  // File input handler
  document.getElementById('fileInput').addEventListener('change', handleFileSelect);
  
  // Animation selection handlers
  document.querySelectorAll('.submenu-item[data-animation]').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const animation = item.dataset.animation;
      await setAnimation(animation);
    });
  });
}

// Load selected animation from storage
async function loadSelectedAnimation() {
  try {
    const data = await chrome.storage.local.get('selectedAnimation');
    const animation = data.selectedAnimation || 'burst';
    updateAnimationCheckmarks(animation);
  } catch (error) {
    console.error('Error loading selected animation:', error);
    updateAnimationCheckmarks('burst');
  }
}

// Set animation preference
async function setAnimation(animationName) {
  await chrome.storage.local.set({ selectedAnimation: animationName });
  updateAnimationCheckmarks(animationName);
}

// Update checkmarks in animation menu
function updateAnimationCheckmarks(selectedAnimation) {
  document.querySelectorAll('.submenu-item[data-animation]').forEach(item => {
    const animation = item.dataset.animation;
    const checkmark = item.querySelector('.checkmark');
    if (animation === selectedAnimation) {
      checkmark.classList.add('active');
    } else {
      checkmark.classList.remove('active');
    }
  });
}

// Filter emojis based on search query
function filterEmojis() {
  const searchInput = document.getElementById('emojiSearch');
  const query = searchInput.value.toLowerCase().trim();
  
  // Get all emoji buttons (both built-in and custom)
  const emojiGrid = document.querySelector('.emoji-grid');
  const allButtons = emojiGrid.querySelectorAll('button[data-type]');
  
  allButtons.forEach(button => {
    if (query === '') {
      // Show all if search is empty
      button.style.display = '';
      return;
    }
    
    let searchText = '';
    
    if (button.dataset.type === 'emoji') {
      // For Unicode emojis, we can't easily search them, so hide them during search
      // Users can clear search to see them again
      button.style.display = 'none';
      return;
    } else if (button.dataset.type === 'image') {
      // For image emojis, check alt text or data-name attribute
      const img = button.querySelector('img');
      searchText = (img?.alt || button.dataset.name || '').toLowerCase();
    }
    
    // Show/hide based on match
    if (searchText.includes(query)) {
      button.style.display = '';
    } else {
      button.style.display = 'none';
    }
  });
  
  // Also filter custom image wrappers
  const customContainer = document.getElementById('customImagesContainer');
  if (customContainer) {
    const wrappers = customContainer.querySelectorAll('.custom-image-wrapper');
    wrappers.forEach(wrapper => {
      const button = wrapper.querySelector('button[data-type="image"]');
      if (button) {
        const name = button.dataset.name || '';
        if (query === '' || name.toLowerCase().includes(query)) {
          wrapper.style.display = '';
        } else {
          wrapper.style.display = 'none';
        }
      }
    });
  }
}

// Migrate existing data from chrome.storage.local to IndexedDB
async function migrateFromChromeStorage() {
  try {
    // Check if migration has already been done
    const migrationStatus = await chrome.storage.local.get('migrationComplete');
    if (migrationStatus.migrationComplete) {
      return; // Already migrated
    }
    
    // Check for old data
    const data = await chrome.storage.local.get('customImages');
    const oldCustomImages = data.customImages || [];
    
    if (oldCustomImages.length === 0) {
      // No data to migrate, mark as complete
      await chrome.storage.local.set({ migrationComplete: true });
      return;
    }
    
    console.log(`Migrating ${oldCustomImages.length} images from chrome.storage to IndexedDB...`);
    
    // Migrate each image
    let successCount = 0;
    for (const imageData of oldCustomImages) {
      try {
        // Convert base64 data URL to Blob
        if (imageData.dataUrl && imageData.dataUrl.startsWith('data:image/')) {
          const response = await fetch(imageData.dataUrl);
          const blob = await response.blob();
          
          // Save to IndexedDB
          await saveImage(blob, imageData.id);
          successCount++;
        }
      } catch (error) {
        console.error(`Failed to migrate image ${imageData.id}:`, error);
      }
    }
    
    console.log(`Successfully migrated ${successCount} of ${oldCustomImages.length} images`);
    
    // Clear old data and mark migration complete
    await chrome.storage.local.remove('customImages');
    await chrome.storage.local.set({ migrationComplete: true });
    
  } catch (error) {
    console.error('Error during migration:', error);
    // Don't throw - allow app to continue functioning
  }
}

// Load custom images from storage
async function loadCustomImages() {
  try {
    // Check for migration from chrome.storage.local to IndexedDB
    await migrateFromChromeStorage();
    
    // Load images from IndexedDB
    const customImages = await getAllImages();
    renderCustomImages(customImages);
  } catch (error) {
    console.error('Error loading custom images:', error);
    renderCustomImages([]);
  }
}

// Save custom image to storage
async function saveCustomImage(blob, id, name = 'Custom Emoji') {
  await saveImage(blob, id, name);
}

// Delete custom image from storage
async function deleteCustomImage(imageId) {
  await deleteImage(imageId);
  await loadCustomImages(); // Refresh the display
}

// Handle add custom image button click
function handleAddCustomImage() {
  openModal();
}

// Handle clear custom images button click
async function handleClearCustomImages() {
  const customImages = await getAllImages();
  
  if (customImages.length === 0) {
    alert('No custom emojis to clear.');
    return;
  }
  
  if (confirm(`Delete all ${customImages.length} custom emoji(s)?`)) {
    await clearAllImages();
    renderCustomImages([]);
    console.log('Custom images cleared successfully');
  }
}

// Handle file selection
async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // Reset file input
  event.target.value = '';
  
  // Validate file type - accept PNG and GIF
  if (!file.type.match('image/(png|gif)')) {
    alert('Please select a PNG or GIF file.');
    return;
  }
  
  // Check file size (10MB limit for IndexedDB - practical for GIFs)
  const maxSize = 10 * 1024 * 1024; // 10MB in bytes
  if (file.size > maxSize) {
    alert('File is too large. Please select a file smaller than 10MB.');
    return;
  }
  
  // Warn if file is very large
  if (file.size > 5 * 1024 * 1024) {
    if (!confirm('This file is quite large (>5MB). Continue?')) {
      return;
    }
  }
  
  // Store file temporarily and show naming modal
  pendingFile = file;
  openModal();
  showNameInputStep();
}

// Process and save the selected image file
async function processImageFile(file, name) {
  // Store file as Blob directly (no base64 conversion needed)
  const imageId = `custom_${Date.now()}`;
  
  try {
    await saveCustomImage(file, imageId, name);
    await loadCustomImages(); // Refresh the display
  } catch (error) {
    if (error.message.includes('quota')) {
      alert('Storage quota exceeded. Please delete some custom images first.');
    } else {
      alert('Error saving image: ' + error.message);
    }
  }
}

// Keep track of object URLs for cleanup
let currentObjectURLs = [];

// Render custom images in the popup
function renderCustomImages(customImages) {
  const container = document.getElementById('customImagesContainer');
  const label = document.getElementById('userAddedLabel');
  
  // Revoke previous object URLs to prevent memory leaks
  currentObjectURLs.forEach(url => URL.revokeObjectURL(url));
  currentObjectURLs = [];
  
  container.innerHTML = ''; // Clear existing content
  
  // Show/hide the "User added" label based on whether we have custom images
  if (customImages.length > 0) {
    label.style.display = 'block';
  } else {
    label.style.display = 'none';
  }
  
  customImages.forEach(imageData => {
    try {
      // Validate image data
      if (!imageData.id || !imageData.objectURL) {
        console.warn('Invalid image data, skipping:', imageData);
        return;
      }
      
      // Track object URL for cleanup
      currentObjectURLs.push(imageData.objectURL);
      
      // Create wrapper for positioning delete button
      const wrapper = document.createElement('div');
      wrapper.className = 'custom-image-wrapper';
      
      // Create the image button
      const button = document.createElement('button');
      button.dataset.type = 'image';
      button.dataset.src = imageData.objectURL;
      button.dataset.name = imageData.name || 'Custom Emoji';
      button.title = imageData.name || 'Custom Emoji'; // Tooltip
      
      const img = document.createElement('img');
      img.src = imageData.objectURL;
      img.alt = imageData.name || 'custom emoji';
      
      // Handle image load errors
      img.onerror = () => {
        console.error('Failed to load image:', imageData.id);
        wrapper.remove();
      };
      
      button.appendChild(img);
      
      // Create delete button
      const deleteBtn = document.createElement('div');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this custom emoji?')) {
          deleteCustomImage(imageData.id);
        }
      });
      
      // Assemble the wrapper
      wrapper.appendChild(button);
      wrapper.appendChild(deleteBtn);
      container.appendChild(wrapper);
      
      // Add click handler for the image button
      button.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Get selected animation
        const data = await chrome.storage.local.get('selectedAnimation');
        const animationType = data.selectedAnimation || 'burst';
        
        // Convert blob to data URL for content script (object URLs don't work across contexts)
        const reader = new FileReader();
        reader.onload = () => {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: showImageOverlay,
            args: [reader.result, animationType]
          });
        };
        reader.readAsDataURL(imageData.blob);
      });
    } catch (error) {
      console.error('Error rendering custom image:', imageData.id, error);
    }
  });
}

// Clean up object URLs when popup closes
window.addEventListener('unload', () => {
  currentObjectURLs.forEach(url => URL.revokeObjectURL(url));
});

function showEmojiOverlay(emoji, animationType = 'burst') {
  if (animationType === 'boring' || animationType === 'boring-giant') {
    // Boring animation - single emoji centered
    const particle = document.createElement("div");
    particle.textContent = emoji;
    
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const duration = 2500;
    const size = animationType === 'boring-giant' ? 30 : 10;
    
    Object.assign(particle.style, {
      position: "fixed",
      left: centerX + "px",
      top: centerY + "px",
      fontSize: size + "rem",
      opacity: "1",
      pointerEvents: "none",
      zIndex: "999999",
      transform: "translate(-50%, -50%)",
      transition: "none"
    });
    
    document.body.appendChild(particle);
    
    const startTime = Date.now();
    
    function animate() {
      const elapsed = (Date.now() - startTime) / 1000;
      const progress = elapsed / (duration / 1000);
      
      if (progress >= 1) return;
      
      const opacity = progress > 0.7 ? (1 - (progress - 0.7) / 0.3) : 1;
      particle.style.opacity = opacity;
      
      requestAnimationFrame(animate);
    }
    
    requestAnimationFrame(animate);
    setTimeout(() => particle.remove(), duration);
    
  } else if (animationType === 'drive') {
    // Drive animation - left to right
    const particleCount = 25;
    const duration = 3000;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("div");
      particle.textContent = emoji;
      
      const startX = -150;
      const startY = Math.random() * window.innerHeight;
      const velocity = 300 + Math.random() * 400;
      const size = 3 + Math.random() * 4;
      
      Object.assign(particle.style, {
        position: "fixed",
        left: startX + "px",
        top: startY + "px",
        fontSize: size + "rem",
        opacity: "1",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
      });
      
      document.body.appendChild(particle);
      
      const startTime = Date.now();
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const x = startX + velocity * elapsed;
        
        const screenWidth = window.innerWidth;
        const fadeStart = screenWidth * 0.8;
        const opacity = x > fadeStart ? 1 - ((x - fadeStart) / (screenWidth * 0.2)) : 1;
        
        particle.style.left = x + "px";
        particle.style.transform = `translate(-50%, -50%)`;
        particle.style.opacity = Math.max(0, opacity);
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
      setTimeout(() => particle.remove(), duration);
    }
    
  } else if (animationType === 'reverse') {
    // Reverse animation - right to left
    const particleCount = 25;
    const duration = 3000;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("div");
      particle.textContent = emoji;
      
      const startX = window.innerWidth + 150;
      const startY = Math.random() * window.innerHeight;
      const velocity = -(300 + Math.random() * 400);
      const size = 3 + Math.random() * 4;
      
      Object.assign(particle.style, {
        position: "fixed",
        left: startX + "px",
        top: startY + "px",
        fontSize: size + "rem",
        opacity: "1",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
      });
      
      document.body.appendChild(particle);
      
      const startTime = Date.now();
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const x = startX + velocity * elapsed;
        
        const fadeStart = window.innerWidth * 0.2;
        const opacity = x < fadeStart ? 1 - ((fadeStart - x) / (window.innerWidth * 0.2)) : 1;
        
        particle.style.left = x + "px";
        particle.style.transform = `translate(-50%, -50%)`;
        particle.style.opacity = Math.max(0, opacity);
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
      setTimeout(() => particle.remove(), duration);
    }
    
  } else if (animationType === 'tornado') {
    // Tornado animation - spiral cyclone
    const particleCount = 25;
    const duration = 4000;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("div");
      particle.textContent = emoji;
      
      const startAngle = (i / particleCount) * Math.PI * 2;
      const size = 3 + Math.random() * 4;
      
      Object.assign(particle.style, {
        position: "fixed",
        left: centerX + "px",
        top: centerY + "px",
        fontSize: size + "rem",
        opacity: "1",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
      });
      
      document.body.appendChild(particle);
      
      const startTime = Date.now();
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const angle = startAngle + elapsed * 3 * Math.PI;
        const radius = progress * 300;
        
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        const rotation = elapsed * 360;
        const opacity = 1 - progress * 0.8;
        
        particle.style.left = x + "px";
        particle.style.top = y + "px";
        particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
        particle.style.opacity = Math.max(0, opacity);
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
      setTimeout(() => particle.remove(), duration);
    }
    
  } else if (animationType === 'wave') {
    // Wave animation - ocean wave
    const particleCount = 25;
    const duration = 4000;
    const waveHeight = window.innerHeight * 0.3;
    const baseY = window.innerHeight / 2;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("div");
      particle.textContent = emoji;
      
      const delay = (i / particleCount) * 1000;
      const size = 3 + Math.random() * 3;
      const verticalOffset = (Math.random() - 0.5) * 100;
      
      Object.assign(particle.style, {
        position: "fixed",
        left: "-100px",
        top: baseY + "px",
        fontSize: size + "rem",
        opacity: "0",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
      });
      
      document.body.appendChild(particle);
      
      setTimeout(() => {
        const startTime = Date.now();
        
        function animate() {
          const elapsed = (Date.now() - startTime) / 1000;
          const progress = elapsed / (duration / 1000);
          
          if (progress >= 1) return;
          
          const x = -100 + progress * (window.innerWidth + 200);
          const waveProgress = (x + 100) / window.innerWidth;
          let waveY;
          
          if (waveProgress < 0.3) {
            waveY = Math.sin(waveProgress * Math.PI * 5) * waveHeight * (waveProgress / 0.3);
          } else if (waveProgress < 0.7) {
            waveY = Math.sin(waveProgress * Math.PI * 3) * waveHeight;
          } else {
            waveY = Math.sin(waveProgress * Math.PI * 5) * waveHeight * (1 - (waveProgress - 0.7) / 0.3);
          }
          
          const y = baseY + waveY + verticalOffset;
          const rotation = Math.sin(waveProgress * Math.PI * 3) * 30;
          
          let opacity = 1;
          if (progress < 0.1) {
            opacity = progress / 0.1;
          } else if (progress > 0.9) {
            opacity = 1 - ((progress - 0.9) / 0.1);
          }
          
          particle.style.left = x + "px";
          particle.style.top = y + "px";
          particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
          particle.style.opacity = opacity;
          
          requestAnimationFrame(animate);
        }
        
        requestAnimationFrame(animate);
      }, delay);
      
      setTimeout(() => particle.remove(), duration + delay);
    }
    
  } else if (animationType === 'drift') {
    // Drift animation
    const waveCount = 4;
    const particlesPerWave = 7;
    const waveInterval = 300;
    const duration = 3500;
    
    function animateRainParticle(particle, startX, duration) {
      const startTime = Date.now();
      const gravity = 500;
      const startY = -100;
      const driftAmplitude = 30;
      const driftFrequency = 2;
      const baseTilt = (Math.random() - 0.5) * 40;
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const y = startY + 0.5 * gravity * elapsed * elapsed;
        const drift = Math.sin(elapsed * driftFrequency * Math.PI) * driftAmplitude;
        const x = startX + drift;
        const tilt = baseTilt + (drift / driftAmplitude) * 15;
        
        const screenHeight = window.innerHeight;
        const fadeStart = screenHeight * 0.8;
        const opacity = y > fadeStart ? 1 - ((y - fadeStart) / (screenHeight * 0.2)) : 1;
        
        particle.style.left = x + "px";
        particle.style.top = y + "px";
        particle.style.transform = `translate(-50%, -50%) rotate(${tilt}deg)`;
        particle.style.opacity = Math.max(0, opacity);
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
    }
    
    for (let wave = 0; wave < waveCount; wave++) {
      setTimeout(() => {
        for (let i = 0; i < particlesPerWave; i++) {
          const particle = document.createElement("div");
          particle.textContent = emoji;
          
          const startX = Math.random() * window.innerWidth;
          const size = 4 + Math.random() * 4;
          
          Object.assign(particle.style, {
            position: "fixed",
            left: startX + "px",
            top: "-100px",
            fontSize: size + "rem",
            opacity: "1",
            pointerEvents: "none",
            zIndex: "999999",
            transform: "translate(-50%, -50%)",
            transition: "none"
          });
          
          document.body.appendChild(particle);
          animateRainParticle(particle, startX, duration);
          setTimeout(() => particle.remove(), duration);
        }
      }, wave * waveInterval);
    }
    
  } else {
    // Burst animation (default)
    function animateParticle(particle, velocityX, velocityY, rotationSpeed, duration) {
      const startTime = Date.now();
      const gravity = 500;
      const startX = parseFloat(particle.style.left);
      const startY = parseFloat(particle.style.top);
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const x = startX + velocityX * elapsed;
        const y = startY + velocityY * elapsed + 0.5 * gravity * elapsed * elapsed;
        const rotation = rotationSpeed * elapsed;
        const opacity = progress > 0.7 ? (1 - (progress - 0.7) / 0.3) : 1;
        
        particle.style.left = x + "px";
        particle.style.top = y + "px";
        particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
        particle.style.opacity = opacity;
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
    }
    
    const particleCount = 25;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const duration = 2500;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("div");
      particle.textContent = emoji;
      
      const angle = Math.random() * Math.PI * 2;
      const velocity = 200 + Math.random() * 300;
      const velocityX = Math.cos(angle) * velocity;
      const velocityY = Math.sin(angle) * velocity;
      const rotationSpeed = (Math.random() - 0.5) * 720;
      const size = 4 + Math.random() * 6;
      
      Object.assign(particle.style, {
        position: "fixed",
        left: centerX + "px",
        top: centerY + "px",
        fontSize: size + "rem",
        opacity: "1",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
      });
      
      document.body.appendChild(particle);
      animateParticle(particle, velocityX, velocityY, rotationSpeed, duration);
      setTimeout(() => particle.remove(), duration);
    }
  }
}

function createBurstAnimation(content, isEmoji) {
  // Helper function to animate particles with physics
  function animateParticle(particle, velocityX, velocityY, rotationSpeed, duration) {
    const startTime = Date.now();
    const gravity = 500; // pixels per second squared
    const startX = parseFloat(particle.style.left);
    const startY = parseFloat(particle.style.top);
    
    function animate() {
      const elapsed = (Date.now() - startTime) / 1000; // seconds
      const progress = elapsed / (duration / 1000);
      
      if (progress >= 1) return;
      
      // Calculate position with gravity
      const x = startX + velocityX * elapsed;
      const y = startY + velocityY * elapsed + 0.5 * gravity * elapsed * elapsed;
      
      // Calculate rotation
      const rotation = rotationSpeed * elapsed;
      
      // Fade out in the last 30% of animation
      const opacity = progress > 0.7 ? (1 - (progress - 0.7) / 0.3) : 1;
      
      // Apply transformations
      particle.style.left = x + "px";
      particle.style.top = y + "px";
      particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
      particle.style.opacity = opacity;
      
      requestAnimationFrame(animate);
    }
    
    requestAnimationFrame(animate);
  }
  
  // Create the burst effect
  const particleCount = 25; // Number of particles
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const duration = 2500; // Animation duration in ms
  
  for (let i = 0; i < particleCount; i++) {
    const particle = isEmoji ? document.createElement("div") : document.createElement("img");
    
    if (isEmoji) {
      particle.textContent = content;
    } else {
      particle.src = content;
    }
    
    // Random velocity and direction
    const angle = Math.random() * Math.PI * 2;
    const velocity = 200 + Math.random() * 300; // pixels per second
    const velocityX = Math.cos(angle) * velocity;
    const velocityY = Math.sin(angle) * velocity;
    
    // Random rotation
    const rotationSpeed = (Math.random() - 0.5) * 720; // degrees per second
    
    // Random size variation
    const size = isEmoji ? (4 + Math.random() * 6) : (80 + Math.random() * 120);
    
    // Initial styles
    const baseStyles = {
      position: "fixed",
      left: centerX + "px",
      top: centerY + "px",
      opacity: "1",
      pointerEvents: "none",
      zIndex: "999999",
      transform: "translate(-50%, -50%)",
      transition: "none"
    };
    
    if (isEmoji) {
      baseStyles.fontSize = size + "rem";
    } else {
      baseStyles.width = size + "px";
      baseStyles.height = size + "px";
    }
    
    Object.assign(particle.style, baseStyles);
    
    document.body.appendChild(particle);
    
    // Animate the particle
    animateParticle(particle, velocityX, velocityY, rotationSpeed, duration);
    
    // Remove after animation
    setTimeout(() => particle.remove(), duration);
  }
}

function createDriftAnimation(content, isEmoji) {
  const waveCount = 4; // Number of waves
  const particlesPerWave = 7; // Particles in each wave
  const waveInterval = 300; // ms between waves
  const duration = 3500; // Total animation duration in ms
  
  // Helper function to animate falling particles
  function animateDriftParticle(particle, startX, duration) {
    const startTime = Date.now();
    const gravity = 500; // pixels per second squared
    const startY = -100; // Start above viewport
    const driftAmplitude = 30; // Horizontal drift amount
    const driftFrequency = 2; // Drift oscillation speed
    const baseTilt = (Math.random() - 0.5) * 40;
    
    function animate() {
      const elapsed = (Date.now() - startTime) / 1000; // seconds
      const progress = elapsed / (duration / 1000);
      
      if (progress >= 1) return;
      
      // Calculate vertical position with gravity
      const y = startY + 0.5 * gravity * elapsed * elapsed;
      
      // Add horizontal drift using sine wave
      const drift = Math.sin(elapsed * driftFrequency * Math.PI) * driftAmplitude;
      const x = startX + drift;
      
      // Calculate tilt based on drift
      const tilt = baseTilt + (drift / driftAmplitude) * 15;
      
      // Fade out near bottom of screen
      const screenHeight = window.innerHeight;
      const fadeStart = screenHeight * 0.8;
      const opacity = y > fadeStart ? 1 - ((y - fadeStart) / (screenHeight * 0.2)) : 1;
      
      // Apply transformations
      particle.style.left = x + "px";
      particle.style.top = y + "px";
      particle.style.transform = `translate(-50%, -50%) rotate(${tilt}deg)`;
      particle.style.opacity = Math.max(0, opacity);
      
      requestAnimationFrame(animate);
    }
    
    requestAnimationFrame(animate);
  }
  
  // Create waves of particles
  for (let wave = 0; wave < waveCount; wave++) {
    setTimeout(() => {
      for (let i = 0; i < particlesPerWave; i++) {
        const particle = isEmoji ? document.createElement("div") : document.createElement("img");
        
        if (isEmoji) {
          particle.textContent = content;
        } else {
          particle.src = content;
        }
        
        // Random horizontal position
        const startX = Math.random() * window.innerWidth;
        
        // Random size variation
        const size = isEmoji ? (4 + Math.random() * 4) : (60 + Math.random() * 80);
        
        // Initial styles
        const baseStyles = {
          position: "fixed",
          left: startX + "px",
          top: "-100px",
          opacity: "1",
          pointerEvents: "none",
          zIndex: "999999",
          transform: "translate(-50%, -50%)",
          transition: "none"
        };
        
        if (isEmoji) {
          baseStyles.fontSize = size + "rem";
        } else {
          baseStyles.width = size + "px";
          baseStyles.height = size + "px";
        }
        
        Object.assign(particle.style, baseStyles);
        
        document.body.appendChild(particle);
        
        // Animate the particle
        animateDriftParticle(particle, startX, duration);
        
        // Remove after animation
        setTimeout(() => particle.remove(), duration);
      }
    }, wave * waveInterval);
  }
}

function createBoringAnimation(content, isEmoji, isGiant = false) {
  const particle = isEmoji ? document.createElement("div") : document.createElement("img");
  
  if (isEmoji) {
    particle.textContent = content;
  } else {
    particle.src = content;
  }
  
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const duration = 2500; // Animation duration in ms
  const size = isGiant ? 30 : 10; // Giant is 3x normal size
  
  // Initial styles
  const baseStyles = {
    position: "fixed",
    left: centerX + "px",
    top: centerY + "px",
    opacity: "1",
    pointerEvents: "none",
    zIndex: "999999",
    transform: "translate(-50%, -50%)",
    transition: "none"
  };
  
  if (isEmoji) {
    baseStyles.fontSize = size + "rem";
  } else {
    baseStyles.width = (size * 20) + "px"; // Convert rem-like size to pixels for images
    baseStyles.height = (size * 20) + "px";
  }
  
  Object.assign(particle.style, baseStyles);
  document.body.appendChild(particle);
  
  // Animate fade out
      const startTime = Date.now();
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
    // Fade out in the last 30% of animation
    const opacity = progress > 0.7 ? (1 - (progress - 0.7) / 0.3) : 1;
    particle.style.opacity = opacity;
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
  setTimeout(() => particle.remove(), duration);
}

function createDriveAnimation(content, isEmoji) {
  const particleCount = 25;
  const duration = 3000; // Animation duration in ms
  
  for (let i = 0; i < particleCount; i++) {
    const particle = isEmoji ? document.createElement("div") : document.createElement("img");
    
    if (isEmoji) {
      particle.textContent = content;
    } else {
      particle.src = content;
    }
    
    // Random starting position on the left side, off-screen
    const startX = -150;
    const startY = Math.random() * window.innerHeight;
    
    // Random velocity (how fast they move right)
    const velocity = 300 + Math.random() * 400; // pixels per second
    
    // Random size variation
    const size = isEmoji ? (3 + Math.random() * 4) : (60 + Math.random() * 80);
    
    // Initial styles
    const baseStyles = {
            position: "fixed",
            left: startX + "px",
      top: startY + "px",
            opacity: "1",
            pointerEvents: "none",
            zIndex: "999999",
            transform: "translate(-50%, -50%)",
            transition: "none"
    };
    
    if (isEmoji) {
      baseStyles.fontSize = size + "rem";
    } else {
      baseStyles.width = size + "px";
      baseStyles.height = size + "px";
    }
    
    Object.assign(particle.style, baseStyles);
          document.body.appendChild(particle);
    
    // Animate particle moving left to right
    const startTime = Date.now();
    
    function animate() {
      const elapsed = (Date.now() - startTime) / 1000;
      const progress = elapsed / (duration / 1000);
      
      if (progress >= 1) return;
      
      const x = startX + velocity * elapsed;
      
      // Fade out near the right edge
      const screenWidth = window.innerWidth;
      const fadeStart = screenWidth * 0.8;
      const opacity = x > fadeStart ? 1 - ((x - fadeStart) / (screenWidth * 0.2)) : 1;
      
      particle.style.left = x + "px";
      particle.style.transform = `translate(-50%, -50%)`;
      particle.style.opacity = Math.max(0, opacity);
      
      requestAnimationFrame(animate);
    }
    
    requestAnimationFrame(animate);
          setTimeout(() => particle.remove(), duration);
        }
}

function createReverseAnimation(content, isEmoji) {
  const particleCount = 25;
  const duration = 3000; // Animation duration in ms
  
  for (let i = 0; i < particleCount; i++) {
    const particle = isEmoji ? document.createElement("div") : document.createElement("img");
    
    if (isEmoji) {
      particle.textContent = content;
  } else {
      particle.src = content;
    }
    
    // Random starting position on the right side, off-screen
    const startX = window.innerWidth + 150;
    const startY = Math.random() * window.innerHeight;
    
    // Random velocity (how fast they move left, negative)
    const velocity = -(300 + Math.random() * 400); // pixels per second (negative for left movement)
    
    // Random size variation
    const size = isEmoji ? (3 + Math.random() * 4) : (60 + Math.random() * 80);
    
    // Initial styles
    const baseStyles = {
      position: "fixed",
      left: startX + "px",
      top: startY + "px",
      opacity: "1",
      pointerEvents: "none",
      zIndex: "999999",
      transform: "translate(-50%, -50%)",
      transition: "none"
    };
    
    if (isEmoji) {
      baseStyles.fontSize = size + "rem";
    } else {
      baseStyles.width = size + "px";
      baseStyles.height = size + "px";
    }
    
    Object.assign(particle.style, baseStyles);
    document.body.appendChild(particle);
    
    // Animate particle moving right to left
      const startTime = Date.now();
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
      const x = startX + velocity * elapsed;
      
      // Fade out near the left edge
      const fadeStart = window.innerWidth * 0.2;
      const opacity = x < fadeStart ? 1 - ((fadeStart - x) / (window.innerWidth * 0.2)) : 1;
        
        particle.style.left = x + "px";
        particle.style.transform = `translate(-50%, -50%)`;
      particle.style.opacity = Math.max(0, opacity);
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
    setTimeout(() => particle.remove(), duration);
  }
    }
    
function createTornadoAnimation(content, isEmoji) {
    const particleCount = 25;
  const duration = 4000; // Animation duration in ms
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    
    for (let i = 0; i < particleCount; i++) {
    const particle = isEmoji ? document.createElement("div") : document.createElement("img");
    
    if (isEmoji) {
      particle.textContent = content;
    } else {
      particle.src = content;
    }
    
    // Each particle starts at a different angle
    const startAngle = (i / particleCount) * Math.PI * 2;
    
    // Random size variation
    const size = isEmoji ? (3 + Math.random() * 4) : (60 + Math.random() * 80);
    
    // Initial styles
    const baseStyles = {
        position: "fixed",
        left: centerX + "px",
        top: centerY + "px",
        opacity: "1",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
    };
    
    if (isEmoji) {
      baseStyles.fontSize = size + "rem";
    } else {
      baseStyles.width = size + "px";
      baseStyles.height = size + "px";
    }
    
    Object.assign(particle.style, baseStyles);
      document.body.appendChild(particle);
    
    // Animate in cyclone/tornado spiral pattern
    const startTime = Date.now();
    
    function animate() {
      const elapsed = (Date.now() - startTime) / 1000;
      const progress = elapsed / (duration / 1000);
      
      if (progress >= 1) return;
      
      // Spiral outward while rotating
      const angle = startAngle + elapsed * 3 * Math.PI; // 1.5 full rotations per second
      const radius = progress * 300; // Spiral outward
      
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      
      // Particle spins on its own axis
      const rotation = elapsed * 360;
      
      // Fade out as it spirals out
      const opacity = 1 - progress * 0.8;
      
      particle.style.left = x + "px";
      particle.style.top = y + "px";
      particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
      particle.style.opacity = Math.max(0, opacity);
      
      requestAnimationFrame(animate);
    }
    
    requestAnimationFrame(animate);
      setTimeout(() => particle.remove(), duration);
    }
}

function createWaveAnimation(content, isEmoji) {
  const particleCount = 25;
  const duration = 4000; // Animation duration in ms
  const waveHeight = window.innerHeight * 0.3; // Wave amplitude
  const baseY = window.innerHeight / 2;
  
  for (let i = 0; i < particleCount; i++) {
    const particle = isEmoji ? document.createElement("div") : document.createElement("img");
    
    if (isEmoji) {
      particle.textContent = content;
    } else {
      particle.src = content;
    }
    
    // Stagger the start positions across the left side
    const delay = (i / particleCount) * 1000; // Stagger by up to 1 second
    
    // Random size variation
    const size = isEmoji ? (3 + Math.random() * 3) : (60 + Math.random() * 60);
    
    // Random vertical offset within the wave
    const verticalOffset = (Math.random() - 0.5) * 100;
    
    // Initial styles
    const baseStyles = {
      position: "fixed",
      left: "-100px",
      top: baseY + "px",
      opacity: "0",
      pointerEvents: "none",
      zIndex: "999999",
      transform: "translate(-50%, -50%)",
      transition: "none"
    };
    
    if (isEmoji) {
      baseStyles.fontSize = size + "rem";
    } else {
      baseStyles.width = size + "px";
      baseStyles.height = size + "px";
    }
    
    Object.assign(particle.style, baseStyles);
    document.body.appendChild(particle);
    
    // Animate wave motion
    setTimeout(() => {
      const startTime = Date.now();
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        // Move from left to right
        const x = -100 + progress * (window.innerWidth + 200);
        
        // Wave motion (sine wave that "crests" and "crashes")
        // Creates an ocean wave effect
        const waveProgress = (x + 100) / window.innerWidth;
        let waveY;
        
        if (waveProgress < 0.3) {
          // Building wave
          waveY = Math.sin(waveProgress * Math.PI * 5) * waveHeight * (waveProgress / 0.3);
        } else if (waveProgress < 0.7) {
          // Cresting wave
          waveY = Math.sin(waveProgress * Math.PI * 3) * waveHeight;
        } else {
          // Crashing wave
          waveY = Math.sin(waveProgress * Math.PI * 5) * waveHeight * (1 - (waveProgress - 0.7) / 0.3);
        }
        
        const y = baseY + waveY + verticalOffset;
        
        // Rotation based on wave direction
        const rotation = Math.sin(waveProgress * Math.PI * 3) * 30;
        
        // Fade in at start, fade out at end
        let opacity = 1;
        if (progress < 0.1) {
          opacity = progress / 0.1;
        } else if (progress > 0.9) {
          opacity = 1 - ((progress - 0.9) / 0.1);
        }
        
        particle.style.left = x + "px";
        particle.style.top = y + "px";
        particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
        particle.style.opacity = opacity;
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
    }, delay);
    
    setTimeout(() => particle.remove(), duration + delay);
  }
}

function showImageOverlay(src, animationType = 'burst') {
  if (animationType === 'boring' || animationType === 'boring-giant') {
    // Boring animation - single image centered
    const particle = document.createElement("img");
    particle.src = src;
    
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const duration = 2500;
    const size = animationType === 'boring-giant' ? 600 : 200;
    
    Object.assign(particle.style, {
      position: "fixed",
      left: centerX + "px",
      top: centerY + "px",
      width: size + "px",
      height: size + "px",
      opacity: "1",
      pointerEvents: "none",
      zIndex: "999999",
      transform: "translate(-50%, -50%)",
      transition: "none"
    });
    
    document.body.appendChild(particle);
    
    const startTime = Date.now();
    
    function animate() {
      const elapsed = (Date.now() - startTime) / 1000;
      const progress = elapsed / (duration / 1000);
      
      if (progress >= 1) return;
      
      const opacity = progress > 0.7 ? (1 - (progress - 0.7) / 0.3) : 1;
      particle.style.opacity = opacity;
      
      requestAnimationFrame(animate);
    }
    
    requestAnimationFrame(animate);
    setTimeout(() => particle.remove(), duration);
    
  } else if (animationType === 'drive') {
    // Drive animation - left to right
    const particleCount = 25;
    const duration = 3000;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("img");
      particle.src = src;
      
      const startX = -150;
      const startY = Math.random() * window.innerHeight;
      const velocity = 300 + Math.random() * 400;
      const size = 60 + Math.random() * 80;
      
      Object.assign(particle.style, {
        position: "fixed",
        left: startX + "px",
        top: startY + "px",
        width: size + "px",
        height: size + "px",
        opacity: "1",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
      });
      
      document.body.appendChild(particle);
      
      const startTime = Date.now();
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const x = startX + velocity * elapsed;
        
        const screenWidth = window.innerWidth;
        const fadeStart = screenWidth * 0.8;
        const opacity = x > fadeStart ? 1 - ((x - fadeStart) / (screenWidth * 0.2)) : 1;
        
        particle.style.left = x + "px";
        particle.style.transform = `translate(-50%, -50%)`;
        particle.style.opacity = Math.max(0, opacity);
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
      setTimeout(() => particle.remove(), duration);
    }
    
  } else if (animationType === 'reverse') {
    // Reverse animation - right to left
    const particleCount = 25;
    const duration = 3000;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("img");
      particle.src = src;
      
      const startX = window.innerWidth + 150;
      const startY = Math.random() * window.innerHeight;
      const velocity = -(300 + Math.random() * 400);
      const size = 60 + Math.random() * 80;
      
      Object.assign(particle.style, {
        position: "fixed",
        left: startX + "px",
        top: startY + "px",
        width: size + "px",
        height: size + "px",
        opacity: "1",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
      });
      
      document.body.appendChild(particle);
      
      const startTime = Date.now();
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const x = startX + velocity * elapsed;
        
        const fadeStart = window.innerWidth * 0.2;
        const opacity = x < fadeStart ? 1 - ((fadeStart - x) / (window.innerWidth * 0.2)) : 1;
        
        particle.style.left = x + "px";
        particle.style.transform = `translate(-50%, -50%)`;
        particle.style.opacity = Math.max(0, opacity);
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
      setTimeout(() => particle.remove(), duration);
    }
    
  } else if (animationType === 'tornado') {
    // Tornado animation - spiral cyclone
    const particleCount = 25;
    const duration = 4000;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("img");
      particle.src = src;
      
      const startAngle = (i / particleCount) * Math.PI * 2;
      const size = 60 + Math.random() * 80;
      
      Object.assign(particle.style, {
        position: "fixed",
        left: centerX + "px",
        top: centerY + "px",
        width: size + "px",
        height: size + "px",
        opacity: "1",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
      });
      
      document.body.appendChild(particle);
      
      const startTime = Date.now();
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const angle = startAngle + elapsed * 3 * Math.PI;
        const radius = progress * 300;
        
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        const rotation = elapsed * 360;
        const opacity = 1 - progress * 0.8;
        
        particle.style.left = x + "px";
        particle.style.top = y + "px";
        particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
        particle.style.opacity = Math.max(0, opacity);
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
      setTimeout(() => particle.remove(), duration);
    }
    
  } else if (animationType === 'wave') {
    // Wave animation - ocean wave
    const particleCount = 25;
    const duration = 4000;
    const waveHeight = window.innerHeight * 0.3;
    const baseY = window.innerHeight / 2;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("img");
      particle.src = src;
      
      const delay = (i / particleCount) * 1000;
      const size = 60 + Math.random() * 60;
      const verticalOffset = (Math.random() - 0.5) * 100;
      
      Object.assign(particle.style, {
        position: "fixed",
        left: "-100px",
        top: baseY + "px",
        width: size + "px",
        height: size + "px",
        opacity: "0",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
      });
      
      document.body.appendChild(particle);
      
      setTimeout(() => {
        const startTime = Date.now();
        
        function animate() {
          const elapsed = (Date.now() - startTime) / 1000;
          const progress = elapsed / (duration / 1000);
          
          if (progress >= 1) return;
          
          const x = -100 + progress * (window.innerWidth + 200);
          const waveProgress = (x + 100) / window.innerWidth;
          let waveY;
          
          if (waveProgress < 0.3) {
            waveY = Math.sin(waveProgress * Math.PI * 5) * waveHeight * (waveProgress / 0.3);
          } else if (waveProgress < 0.7) {
            waveY = Math.sin(waveProgress * Math.PI * 3) * waveHeight;
          } else {
            waveY = Math.sin(waveProgress * Math.PI * 5) * waveHeight * (1 - (waveProgress - 0.7) / 0.3);
          }
          
          const y = baseY + waveY + verticalOffset;
          const rotation = Math.sin(waveProgress * Math.PI * 3) * 30;
          
          let opacity = 1;
          if (progress < 0.1) {
            opacity = progress / 0.1;
          } else if (progress > 0.9) {
            opacity = 1 - ((progress - 0.9) / 0.1);
          }
          
          particle.style.left = x + "px";
          particle.style.top = y + "px";
          particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
          particle.style.opacity = opacity;
          
          requestAnimationFrame(animate);
        }
        
        requestAnimationFrame(animate);
      }, delay);
      
      setTimeout(() => particle.remove(), duration + delay);
    }
    
  } else if (animationType === 'drift') {
    // Drift animation
    const waveCount = 4;
    const particlesPerWave = 7;
    const waveInterval = 300;
    const duration = 3500;
    
    function animateRainParticle(particle, startX, duration) {
      const startTime = Date.now();
      const gravity = 500;
      const startY = -100;
      const driftAmplitude = 30;
      const driftFrequency = 2;
      const baseTilt = (Math.random() - 0.5) * 40;
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const y = startY + 0.5 * gravity * elapsed * elapsed;
        const drift = Math.sin(elapsed * driftFrequency * Math.PI) * driftAmplitude;
        const x = startX + drift;
        const tilt = baseTilt + (drift / driftAmplitude) * 15;
        
        const screenHeight = window.innerHeight;
        const fadeStart = screenHeight * 0.8;
        const opacity = y > fadeStart ? 1 - ((y - fadeStart) / (screenHeight * 0.2)) : 1;
        
        particle.style.left = x + "px";
        particle.style.top = y + "px";
        particle.style.transform = `translate(-50%, -50%) rotate(${tilt}deg)`;
        particle.style.opacity = Math.max(0, opacity);
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
    }
    
    for (let wave = 0; wave < waveCount; wave++) {
      setTimeout(() => {
        for (let i = 0; i < particlesPerWave; i++) {
          const particle = document.createElement("img");
          particle.src = src;
          
          const startX = Math.random() * window.innerWidth;
          const size = 60 + Math.random() * 80;
          
          Object.assign(particle.style, {
            position: "fixed",
            left: startX + "px",
            top: "-100px",
            width: size + "px",
            height: size + "px",
            opacity: "1",
            pointerEvents: "none",
            zIndex: "999999",
            transform: "translate(-50%, -50%)",
            transition: "none"
          });
          
          document.body.appendChild(particle);
          animateRainParticle(particle, startX, duration);
          setTimeout(() => particle.remove(), duration);
        }
      }, wave * waveInterval);
    }
    
  } else {
    // Burst animation (default)
    function animateParticle(particle, velocityX, velocityY, rotationSpeed, duration) {
      const startTime = Date.now();
      const gravity = 500;
      const startX = parseFloat(particle.style.left);
      const startY = parseFloat(particle.style.top);
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const x = startX + velocityX * elapsed;
        const y = startY + velocityY * elapsed + 0.5 * gravity * elapsed * elapsed;
        const rotation = rotationSpeed * elapsed;
        const opacity = progress > 0.7 ? (1 - (progress - 0.7) / 0.3) : 1;
        
        particle.style.left = x + "px";
        particle.style.top = y + "px";
        particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
        particle.style.opacity = opacity;
        
        requestAnimationFrame(animate);
      }
      
      requestAnimationFrame(animate);
    }
    
    const particleCount = 25;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const duration = 2500;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("img");
      particle.src = src;
      
      const angle = Math.random() * Math.PI * 2;
      const velocity = 200 + Math.random() * 300;
      const velocityX = Math.cos(angle) * velocity;
      const velocityY = Math.sin(angle) * velocity;
      const rotationSpeed = (Math.random() - 0.5) * 720;
      const size = 80 + Math.random() * 120;
      
      Object.assign(particle.style, {
        position: "fixed",
        left: centerX + "px",
        top: centerY + "px",
        width: size + "px",
        height: size + "px",
        opacity: "1",
        pointerEvents: "none",
        zIndex: "999999",
        transform: "translate(-50%, -50%)",
        transition: "none"
      });
      
      document.body.appendChild(particle);
      animateParticle(particle, velocityX, velocityY, rotationSpeed, duration);
      setTimeout(() => particle.remove(), duration);
    }
  }
}

// ===== MODAL INTERACTION LOGIC =====

function setupModalListeners() {
  // Option selection
  document.getElementById('uploadOption').addEventListener('click', () => {
    closeModal();
    document.getElementById('fileInput').click();
  });

  document.getElementById('aiOption').addEventListener('click', handleAIOptionClick);

  // Modal close
  document.getElementById('modalClose').addEventListener('click', closeModal);

  // API Key navigation
  document.getElementById('apiKeyBack').addEventListener('click', showModalStep1);
  document.getElementById('apiKeySubmit').addEventListener('click', handleApiKeySubmit);

  // Name input navigation (for uploads)
  document.getElementById('nameBack').addEventListener('click', () => {
    closeModal();
    pendingFile = null;
  });
  document.getElementById('nameSubmit').addEventListener('click', handleNameSubmit);

  // Prompt navigation
  document.getElementById('promptBack').addEventListener('click', async () => {
    const apiKey = await getApiKey();
    if (apiKey) {
      showModalStep1();
    } else {
      showModalStep2();
    }
  });
  document.getElementById('generateBtn').addEventListener('click', handleGenerateEmoji);

  // Allow Enter key to submit
  document.getElementById('apiKeyField').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleApiKeySubmit();
    }
  });

  document.getElementById('promptField').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleGenerateEmoji();
    }
  });

  document.getElementById('nameField').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleNameSubmit();
    }
  });

  // Close modal on overlay click
  document.getElementById('aiModal').addEventListener('click', (e) => {
    if (e.target.id === 'aiModal') {
      closeModal();
    }
  });
}

function openModal() {
  document.getElementById('aiModal').style.display = 'flex';
  showModalStep1();
}

function closeModal() {
  document.getElementById('aiModal').style.display = 'none';
  clearModalMessage();
  clearNameModalMessage();
  // Clear inputs
  document.getElementById('apiKeyField').value = '';
  document.getElementById('promptField').value = '';
  document.getElementById('nameField').value = '';
  document.getElementById('aiNameField').value = '';
  pendingFile = null;
}

function showModalStep1() {
  hideAllModalSteps();
  document.getElementById('optionSelect').style.display = 'block';
  clearModalMessage();
}

function showModalStep2() {
  hideAllModalSteps();
  document.getElementById('apiKeyInput').style.display = 'block';
  document.getElementById('apiKeyField').focus();
  clearModalMessage();
}

function showModalStep3() {
  hideAllModalSteps();
  document.getElementById('promptInput').style.display = 'block';
  document.getElementById('promptField').focus();
  clearModalMessage();
}

function showLoadingState() {
  hideAllModalSteps();
  document.getElementById('loadingState').style.display = 'block';
}

function hideAllModalSteps() {
  document.getElementById('optionSelect').style.display = 'none';
  document.getElementById('apiKeyInput').style.display = 'none';
  document.getElementById('nameInput').style.display = 'none';
  document.getElementById('promptInput').style.display = 'none';
  document.getElementById('loadingState').style.display = 'none';
}

function showNameInputStep() {
  hideAllModalSteps();
  document.getElementById('nameInput').style.display = 'block';
  document.getElementById('nameField').focus();
  clearNameModalMessage();
}

async function handleNameSubmit() {
  const nameField = document.getElementById('nameField');
  const name = nameField.value.trim() || 'Custom Emoji';

  if (!pendingFile) {
    showNameModalError('No file selected');
    return;
  }

  try {
    await processImageFile(pendingFile, name);
    closeModal();
    pendingFile = null;
  } catch (error) {
    showNameModalError('Error saving emoji: ' + error.message);
  }
}

function showNameModalError(message) {
  const messageDiv = document.getElementById('nameModalMessage');
  messageDiv.textContent = message;
  messageDiv.className = 'modal-message error';
}

function clearNameModalMessage() {
  const messageDiv = document.getElementById('nameModalMessage');
  if (messageDiv) {
    messageDiv.textContent = '';
    messageDiv.className = 'modal-message';
  }
}

async function handleAIOptionClick() {
  const apiKey = await getApiKey();
  if (apiKey && validateApiKey(apiKey)) {
    showModalStep3();
  } else {
    showModalStep2();
  }
}

async function handleApiKeySubmit() {
  const apiKeyField = document.getElementById('apiKeyField');
  const apiKey = apiKeyField.value.trim();

  if (!validateApiKey(apiKey)) {
    showModalError('Please enter a valid OpenAI API key (starts with sk-)');
    return;
  }

  await saveApiKey(apiKey);
  showModalStep3();
}

async function handleGenerateEmoji() {
  const promptField = document.getElementById('promptField');
  const aiNameField = document.getElementById('aiNameField');
  const prompt = promptField.value.trim();
  const name = aiNameField.value.trim() || 'AI Generated';

  if (!prompt) {
    showModalError('Please describe the emoji you want to generate');
    return;
  }

  const generateBtn = document.getElementById('generateBtn');
  generateBtn.disabled = true;

  try {
    showLoadingState();

    const apiKey = await getApiKey();
    if (!apiKey) {
      throw new Error('No API key found');
    }

    // Generate image
    const imageUrl = await generateImageWithOpenAI(prompt, apiKey);

    // Download as blob
    const blob = await downloadImageAsBlob(imageUrl);

    // Save to IndexedDB with custom name
    const imageId = `ai_generated_${Date.now()}`;
    await saveCustomImage(blob, imageId, name);

    // Refresh display
    await loadCustomImages();

    // Close modal and show success
    closeModal();
    console.log('AI emoji generated successfully:', imageId);

  } catch (error) {
    console.error('Error generating emoji:', error);
    showModalStep3();
    showModalError(getErrorMessage(error));
  } finally {
    generateBtn.disabled = false;
  }
}

function showModalError(message) {
  const messageDiv = document.getElementById('modalMessage');
  messageDiv.textContent = message;
  messageDiv.className = 'modal-message error';
}

function showModalSuccess(message) {
  const messageDiv = document.getElementById('modalMessage');
  messageDiv.textContent = message;
  messageDiv.className = 'modal-message success';
}

function clearModalMessage() {
  const messageDiv = document.getElementById('modalMessage');
  messageDiv.textContent = '';
  messageDiv.className = 'modal-message';
}

function getErrorMessage(error) {
  const message = error.message || 'Unknown error';
  
  if (message.includes('401') || message.includes('authentication')) {
    return 'Invalid API key. Please check your OpenAI API key and try again.';
  }
  
  if (message.includes('429') || message.includes('rate limit')) {
    return 'Rate limit exceeded. Please wait a moment and try again.';
  }
  
  if (message.includes('quota')) {
    return 'API quota exceeded. Please check your OpenAI account.';
  }
  
  if (message.includes('content_policy')) {
    return 'Your prompt was flagged by content policy. Please try a different description.';
  }
  
  if (message.includes('network') || message.includes('fetch')) {
    return 'Network error. Please check your connection and try again.';
  }
  
  return `Error: ${message}`;
}
