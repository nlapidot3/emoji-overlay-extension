// Initialize on popup load
document.addEventListener('DOMContentLoaded', () => {
  loadCustomImages();
  setupEventListeners();
});

function setupEventListeners() {
  document.querySelectorAll("button").forEach(button => {
    // Skip the add button, it has its own handler
    if (button.id === 'addCustomBtn') return;
    
    button.addEventListener("click", async () => {
      const type = button.dataset.type;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (type === "emoji") {
        const emoji = button.dataset.value;
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showEmojiOverlay,
          args: [emoji]
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
          args: [src]
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
}

// Load custom images from storage
async function loadCustomImages() {
  try {
    const data = await chrome.storage.local.get('customImages');
    const customImages = data.customImages || [];
    renderCustomImages(customImages);
  } catch (error) {
    console.error('Error loading custom images:', error);
    // Clear corrupted data and retry
    await chrome.storage.local.remove('customImages');
    renderCustomImages([]);
  }
}

// Save custom image to storage
async function saveCustomImage(imageData) {
  const data = await chrome.storage.local.get('customImages');
  const customImages = data.customImages || [];
  customImages.push(imageData);
  await chrome.storage.local.set({ customImages });
}

// Delete custom image from storage
async function deleteCustomImage(imageId) {
  const data = await chrome.storage.local.get('customImages');
  let customImages = data.customImages || [];
  customImages = customImages.filter(img => img.id !== imageId);
  await chrome.storage.local.set({ customImages });
  renderCustomImages(customImages);
}

// Handle add custom image button click
function handleAddCustomImage() {
  document.getElementById('fileInput').click();
}

// Handle clear custom images button click
async function handleClearCustomImages() {
  const data = await chrome.storage.local.get('customImages');
  const customImages = data.customImages || [];
  
  if (customImages.length === 0) {
    alert('No custom emojis to clear.');
    return;
  }
  
  if (confirm(`Delete all ${customImages.length} custom emoji(s)?`)) {
    await chrome.storage.local.remove('customImages');
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
  // Validate file type
  if (!file.type.match('image/png')) {
    alert('Please select a PNG file.');
    return;
  }
  
  // Check file size (500KB limit for chrome.storage.local)
  const maxSize = 500 * 1024; // 500KB in bytes
  if (file.size > maxSize) {
    alert('File is too large. Please select a PNG smaller than 500KB.');
    return;
  }
  
  // Warn if file is large
  if (file.size > 200 * 1024) {
    if (!confirm('This file is quite large (>200KB). It may use significant storage space. Continue?')) {
      return;
    }
  }
  
  // Read file and convert to data URL
  const reader = new FileReader();
  reader.onload = async (e) => {
    const dataUrl = e.target.result;
    
    // Create image data object
    const imageData = {
      id: `custom_${Date.now()}`,
      dataUrl: dataUrl
    };
    
    try {
      await saveCustomImage(imageData);
      await loadCustomImages(); // Refresh the display
    } catch (error) {
      if (error.message.includes('QUOTA')) {
        alert('Storage quota exceeded. Please delete some custom images first.');
      } else {
        alert('Error saving image: ' + error.message);
      }
    }
  };
  
  reader.onerror = () => {
    alert('Error reading file.');
  };
  
  reader.readAsDataURL(file);
}

// Render custom images in the popup
function renderCustomImages(customImages) {
  const container = document.getElementById('customImagesContainer');
  container.innerHTML = ''; // Clear existing content
  
  customImages.forEach(imageData => {
    try {
      // Validate image data
      if (!imageData.id || !imageData.dataUrl) {
        console.warn('Invalid image data, skipping:', imageData);
        return;
      }
      
      // Validate data URL format
      if (!imageData.dataUrl.startsWith('data:image/')) {
        console.warn('Invalid data URL, skipping:', imageData.id);
        return;
      }
      
      // Create wrapper for positioning delete button
      const wrapper = document.createElement('div');
      wrapper.className = 'custom-image-wrapper';
      
      // Create the image button
      const button = document.createElement('button');
      button.dataset.type = 'image';
      button.dataset.src = imageData.dataUrl;
      
      const img = document.createElement('img');
      img.src = imageData.dataUrl;
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
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: showImageOverlay,
          args: [imageData.dataUrl]
        });
      });
    } catch (error) {
      console.error('Error rendering custom image:', imageData.id, error);
    }
  });
}

function showEmojiOverlay(emoji) {
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
  const emojiCount = 25; // Number of emoji particles
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const duration = 2500; // Animation duration in ms
  
  for (let i = 0; i < emojiCount; i++) {
    const particle = document.createElement("div");
    particle.textContent = emoji;
    
    // Random velocity and direction
    const angle = Math.random() * Math.PI * 2;
    const velocity = 200 + Math.random() * 300; // pixels per second
    const velocityX = Math.cos(angle) * velocity;
    const velocityY = Math.sin(angle) * velocity;
    
    // Random rotation
    const rotationSpeed = (Math.random() - 0.5) * 720; // degrees per second
    
    // Random size variation
    const size = 4 + Math.random() * 6; // 4-10 rem
    
    // Initial styles
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
    
    // Animate the particle
    animateParticle(particle, velocityX, velocityY, rotationSpeed, duration);
    
    // Remove after animation
    setTimeout(() => particle.remove(), duration);
  }
}

function showImageOverlay(src) {
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
  const imageCount = 25; // Number of image particles
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  const duration = 2500; // Animation duration in ms
  
  for (let i = 0; i < imageCount; i++) {
    const particle = document.createElement("img");
    particle.src = src;
    
    // Random velocity and direction
    const angle = Math.random() * Math.PI * 2;
    const velocity = 200 + Math.random() * 300; // pixels per second
    const velocityX = Math.cos(angle) * velocity;
    const velocityY = Math.sin(angle) * velocity;
    
    // Random rotation
    const rotationSpeed = (Math.random() - 0.5) * 720; // degrees per second
    
    // Random size variation
    const size = 80 + Math.random() * 120; // 80-200 px
    
    // Initial styles
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
    
    // Animate the particle
    animateParticle(particle, velocityX, velocityY, rotationSpeed, duration);
    
    // Remove after animation
    setTimeout(() => particle.remove(), duration);
  }
}
