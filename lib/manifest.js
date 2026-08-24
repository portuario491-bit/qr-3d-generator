(function () {
  "use strict";

  window.__BRAND__ = {
    name: "QR3D Studio",
    tagline: "Códigos QR personalizados, listos para imprimir en 3D",

    styles: {
      clasico:    { label: "Clásico",    dots: "square",         corners: "square",        cornerDot: "square" },
      redondeado: { label: "Redondeado", dots: "rounded",        corners: "extra-rounded", cornerDot: "dot"    },
      puntos:     { label: "Puntos",     dots: "dots",           corners: "dot",            cornerDot: "dot"    },
      elegante:   { label: "Elegante",   dots: "classy-rounded", corners: "extra-rounded", cornerDot: "square" }
    },

    presetColors: [
      { base: "#f2f1ec", code: "#1b1b22", label: "Marfil / Negro" },
      { base: "#ffffff", code: "#c9392b", label: "Blanco / Rojo" },
      { base: "#1b1b22", code: "#e8c15a", label: "Negro / Dorado" },
      { base: "#e7e2d8", code: "#2f5233", label: "Crema / Verde" },
      { base: "#dfe7ee", code: "#1c4c7c", label: "Gris azulado / Azul" }
    ],

    emojiPicks: ["🍕","🍽️","⭐","📶","🔑","🏨","📸","🛍️","🎉","☕","🍷","🎈",
                 "💍","🏋️","🐾","🎵","📚","🚗","🏠","❤️","🎂","🍺","🌮","✂️"]
  };
})();
