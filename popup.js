// Initialize on popup load
document.addEventListener('DOMContentLoaded', () => {
  loadCustomImages();
  loadSelectedAnimation();
  setupEventListeners();
});

function setupEventListeners() {
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
async function saveCustomImage(blob, id) {
  await saveImage(blob, id);
}

// Delete custom image from storage
async function deleteCustomImage(imageId) {
  await deleteImage(imageId);
  await loadCustomImages(); // Refresh the display
}

// Handle add custom image button click
function handleAddCustomImage() {
  document.getElementById('fileInput').click();
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
  
  await processImageFile(file);
}

// Process and save the selected image file
async function processImageFile(file) {
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
  
  // Store file as Blob directly (no base64 conversion needed)
  const imageId = `custom_${Date.now()}`;
  
  try {
    await saveCustomImage(file, imageId);
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
  
  // Revoke previous object URLs to prevent memory leaks
  currentObjectURLs.forEach(url => URL.revokeObjectURL(url));
  currentObjectURLs = [];
  
  container.innerHTML = ''; // Clear existing content
  
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
      
      const img = document.createElement('img');
      img.src = imageData.objectURL;
      img.alt = 'custom emoji';
      
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
  if (animationType === 'rain') {
    // Rain animation
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
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const y = startY + 0.5 * gravity * elapsed * elapsed;
        const drift = Math.sin(elapsed * driftFrequency * Math.PI) * driftAmplitude;
        const x = startX + drift;
        const rotation = elapsed * 180;
        
        const screenHeight = window.innerHeight;
        const fadeStart = screenHeight * 0.8;
        const opacity = y > fadeStart ? 1 - ((y - fadeStart) / (screenHeight * 0.2)) : 1;
        
        particle.style.left = x + "px";
        particle.style.top = y + "px";
        particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
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
    // Burst animation
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

function createRainAnimation(content, isEmoji) {
  const waveCount = 4; // Number of waves
  const particlesPerWave = 7; // Particles in each wave
  const waveInterval = 300; // ms between waves
  const duration = 3500; // Total animation duration in ms
  
  // Helper function to animate falling particles
  function animateRainParticle(particle, startX, duration) {
    const startTime = Date.now();
    const gravity = 500; // pixels per second squared
    const startY = -100; // Start above viewport
    const driftAmplitude = 30; // Horizontal drift amount
    const driftFrequency = 2; // Drift oscillation speed
    
    function animate() {
      const elapsed = (Date.now() - startTime) / 1000; // seconds
      const progress = elapsed / (duration / 1000);
      
      if (progress >= 1) return;
      
      // Calculate vertical position with gravity
      const y = startY + 0.5 * gravity * elapsed * elapsed;
      
      // Add horizontal drift using sine wave
      const drift = Math.sin(elapsed * driftFrequency * Math.PI) * driftAmplitude;
      const x = startX + drift;
      
      // Calculate rotation (slower than burst)
      const rotation = elapsed * 180; // degrees
      
      // Fade out near bottom of screen
      const screenHeight = window.innerHeight;
      const fadeStart = screenHeight * 0.8;
      const opacity = y > fadeStart ? 1 - ((y - fadeStart) / (screenHeight * 0.2)) : 1;
      
      // Apply transformations
      particle.style.left = x + "px";
      particle.style.top = y + "px";
      particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
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
        animateRainParticle(particle, startX, duration);
        
        // Remove after animation
        setTimeout(() => particle.remove(), duration);
      }
    }, wave * waveInterval);
  }
}

function showImageOverlay(src, animationType = 'burst') {
  if (animationType === 'rain') {
    // Rain animation for images
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
      
      function animate() {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = elapsed / (duration / 1000);
        
        if (progress >= 1) return;
        
        const y = startY + 0.5 * gravity * elapsed * elapsed;
        const drift = Math.sin(elapsed * driftFrequency * Math.PI) * driftAmplitude;
        const x = startX + drift;
        const rotation = elapsed * 180;
        
        const screenHeight = window.innerHeight;
        const fadeStart = screenHeight * 0.8;
        const opacity = y > fadeStart ? 1 - ((y - fadeStart) / (screenHeight * 0.2)) : 1;
        
        particle.style.left = x + "px";
        particle.style.top = y + "px";
        particle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
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
    // Burst animation for images
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
