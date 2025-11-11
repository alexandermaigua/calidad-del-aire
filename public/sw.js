self.addEventListener('push', function(event) {
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/imagenes/logo.png', // You might want to change this to a real logo
    badge: '/imagenes/badge.png' // And this one too
  };
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});
