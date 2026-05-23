const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.install-panel');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const platform = tab.dataset.platform;
    tabs.forEach((item) => item.classList.toggle('active', item === tab));
    panels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.panel !== platform);
    });
  });
});

const reelSteps = document.querySelectorAll('.reel-step');
let activeStep = 0;

setInterval(() => {
  reelSteps[activeStep].classList.remove('active');
  activeStep = (activeStep + 1) % reelSteps.length;
  reelSteps[activeStep].classList.add('active');
}, 1600);
