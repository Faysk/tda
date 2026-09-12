const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

const lightbox = document.querySelector('#lightbox');
const lightboxImg = lightbox.querySelector('img');
const closeBtn = lightbox.querySelector('.close');

document.querySelectorAll('.image-button').forEach((button) => {
  button.addEventListener('click', () => {
    lightboxImg.src = button.dataset.image;
    lightboxImg.alt = button.querySelector('img')?.alt || '';
    lightbox.showModal();
  });
});

closeBtn.addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (event) => {
  const rect = lightbox.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) lightbox.close();
});
