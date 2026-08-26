(function () {
  "use strict";

  function $(sel, scope) { return (scope || document).querySelector(sel); }
  function $$(sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); }
  function safe(fn, name) { try { return fn(); } catch (e) { console.warn("[" + name + "]", e); } }

  var obj3d = {
    format: "soporte",     // 'soporte' | 'llavero' | 'placa'
    text: "",
    colorBase: "#f2f1ec",
    colorCode: "#1b1b22",
    sizeMM: 90
  };

  var FORMAT_DEF = {
    soporte: { baseKind: "wedge", labelHeight: 4.2 },
    llavero: { baseKind: "flat", thickness: 3.0, labelHeight: 4.4, ringHole: true },
    placa:   { baseKind: "flat", thickness: 3.2, labelHeight: 5.0, wallHoles: true }
  };

  var RELIEF_H = 1.2;       // mm — sweet spot from the recipe
  var RELIEF_SINK = 0.15;   // mm sunk into base to weld cleanly
  var MASK_PX_PER_MODULE = 12;

  // ---------------------------------------------------------------- grid rects (shared: QR relief + text relief)

  function gridRects(on, cols, rows) {
    var used = new Uint8Array(cols * rows);
    var out = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (used[r * cols + c] || !on(r, c)) continue;
        var w = 1;
        while (c + w < cols && !used[r * cols + c + w] && on(r, c + w)) w++;
        var h = 1;
        grow: while (r + h < rows) {
          for (var k = 0; k < w; k++) if (used[(r + h) * cols + c + k] || !on(r + h, c + k)) break grow;
          h++;
        }
        for (var rr = r; rr < r + h; rr++) for (var cc = c; cc < c + w; cc++) used[rr * cols + cc] = 1;
        out.push({ c: c, r: r, w: w, h: h });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- silhouette (center logo/emoji -> B/W mask image)

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  function makeSilhouetteDataUrl(srcDataUrl) {
    return loadImage(srcDataUrl).then(function (img) {
      var size = 200;
      var c = document.createElement("canvas");
      c.width = size; c.height = size;
      var ctx = c.getContext("2d");
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      var imgData = ctx.getImageData(0, 0, size, size);
      var px = imgData.data;
      var transparentCount = 0;
      for (var i = 3; i < px.length; i += 4) if (px[i] < 200) transparentCount++;
      var alphaRatio = transparentCount / (px.length / 4);
      var out = ctx.createImageData(size, size);
      var op = out.data;
      if (alphaRatio > 0.04) {
        for (var a = 0; a < px.length; a += 4) {
          var on = px[a + 3] >= 128;
          op[a] = 0; op[a + 1] = 0; op[a + 2] = 0; op[a + 3] = on ? 255 : 0;
        }
      } else {
        for (var l = 0; l < px.length; l += 4) {
          var lum = 0.299 * px[l] + 0.587 * px[l + 1] + 0.114 * px[l + 2];
          var isDark = lum < 150;
          op[l] = 0; op[l + 1] = 0; op[l + 2] = 0; op[l + 3] = isDark ? 255 : 0;
        }
      }
      ctx.putImageData(out, 0, 0);
      return c.toDataURL("image/png");
    });
  }

  // ---------------------------------------------------------------- QR matrix + styled B/W mask

  function readMatrix(inst) {
    var qr = inst && inst._qr;
    if (!qr || typeof qr.getModuleCount !== "function") return null;
    var n = qr.getModuleCount();
    var bits = new Uint8Array(n * n);
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) bits[r * n + c] = qr.isDark(r, c) ? 1 : 0;
    return { n: n, isDark: function (r, c) { return !!bits[r * n + c]; } };
  }

  function buildStyledMask(n, silhouetteUrl) {
    var api = window.__QR__;
    var px = n * MASK_PX_PER_MODULE;
    var opts = api.buildOptions(px, "canvas");
    opts.margin = 0;
    opts.dotsOptions.color = "#000000";
    opts.cornersSquareOptions.color = "#000000";
    opts.cornersDotOptions.color = "#000000";
    opts.backgroundOptions = { color: "#ffffff" };
    if (silhouetteUrl) {
      opts.image = silhouetteUrl;
      opts.imageOptions = { crossOrigin: "anonymous", margin: 4, imageSize: 0.4, hideBackgroundDots: true };
    } else {
      delete opts.image;
    }
    var inst = new window.QRCodeStyling(opts);
    return inst.getRawData("png").then(function (blob) {
      return loadImage(URL.createObjectURL(blob));
    }).then(function (img) {
      var c = document.createElement("canvas");
      c.width = px; c.height = px;
      var ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, px, px);
      var data = ctx.getImageData(0, 0, px, px).data;
      return {
        px: px,
        on: function (r, c2) {
          var x = Math.min(px - 1, Math.floor((c2 + 0.5) * MASK_PX_PER_MODULE));
          var y = Math.min(px - 1, Math.floor((r + 0.5) * MASK_PX_PER_MODULE));
          var i = (y * px + x) * 4;
          var lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          return lum < 128;
        }
      };
    });
  }

  // ---------------------------------------------------------------- text -> bit grid

  function textToGrid(text, cols, rows) {
    if (!text) return null;
    var c = document.createElement("canvas");
    var scale = 8;
    c.width = cols * scale; c.height = rows * scale;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#000";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var fontSize = Math.floor(rows * scale * 0.72);
    ctx.font = "700 " + fontSize + "px Sora, Inter, sans-serif";
    var w = ctx.measureText(text).width;
    var maxW = c.width * 0.94;
    if (w > maxW) fontSize = Math.floor(fontSize * (maxW / w));
    ctx.font = "700 " + fontSize + "px Sora, Inter, sans-serif";
    ctx.fillText(text, c.width / 2, c.height / 2 + fontSize * 0.03);
    var data = ctx.getImageData(0, 0, c.width, c.height).data;
    return {
      cols: cols, rows: rows,
      on: function (r, cc) {
        var x = Math.min(c.width - 1, Math.floor((cc + 0.5) * scale));
        var y = Math.min(c.height - 1, Math.floor((r + 0.5) * scale));
        var i = (y * c.width + x) * 4;
        return data[i] < 128;
      }
    };
  }

  // ---------------------------------------------------------------- geometry builder (box-soup, hand-written)

  function GeoBuilder() {
    this.positions = [];
    this.normals = [];
    this.index = [];
    this.vertMap = new Map();
  }
  GeoBuilder.prototype._vkey = function (x, y, z) {
    return Math.round(x * 1000) + "_" + Math.round(y * 1000) + "_" + Math.round(z * 1000);
  };
  GeoBuilder.prototype._addVert = function (x, y, z) {
    var key = this._vkey(x, y, z);
    var existing = this.vertMap.get(key);
    if (existing !== undefined) return existing;
    var idx = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.vertMap.set(key, idx);
    return idx;
  };
  GeoBuilder.prototype.addBox = function (x0, y0, z0, x1, y1, z1) {
    var self = this;
    function face(p0, p1, p2, p3, nx, ny, nz) {
      var i0 = self._addVert(p0[0], p0[1], p0[2]);
      var i1 = self._addVert(p1[0], p1[1], p1[2]);
      var i2 = self._addVert(p2[0], p2[1], p2[2]);
      var i3 = self._addVert(p3[0], p3[1], p3[2]);
      if (i0 === i1 || i1 === i2 || i2 === i3 || i0 === i2) return;
      self.index.push(i0, i1, i2, i0, i2, i3);
    }
    face([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1], 0,0,1);
    face([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0], 0,0,-1);
    face([x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0], 0,1,0);
    face([x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y0,z0], 0,-1,0);
    face([x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1], 1,0,0);
    face([x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[x0,y0,z0], -1,0,0);
  };
  // Wedge box: 8 explicit vertices, top face inclined (z at y0 = zTop0, z at y1 = zTop1)
  GeoBuilder.prototype.addWedgeSlab = function (x0, y0, x1, y1, zBot, zTop0, zTop1) {
    var self = this;
    function face(pts, nx, ny, nz) {
      var idxs = pts.map(function (p) { return self._addVert(p[0], p[1], p[2]); });
      for (var i = 1; i < idxs.length - 1; i++) {
        if (idxs[0] === idxs[i] || idxs[i] === idxs[i+1] || idxs[0] === idxs[i+1]) continue;
        self.index.push(idxs[0], idxs[i], idxs[i + 1]);
      }
    }
    var bl = [x0,y0,zBot], br=[x1,y0,zBot], fl=[x0,y1,zBot], fr=[x1,y1,zBot];
    var tbl=[x0,y0,zTop0], tbr=[x1,y0,zTop0], tfl=[x0,y1,zTop1], tfr=[x1,y1,zTop1];
    face([bl,br,tbr,tbl],0,0,0);   // back (y0)
    face([fr,fl,tfl,tfr],0,0,0);   // front (y1)
    face([tbl,tbr,tfr,tfl],0,0,0); // top (inclined)
    face([br,bl,fl,fr],0,0,0);     // bottom
    face([bl,tbl,tfl,fl],0,0,0);   // left
    face([fr,tfr,tbr,br],0,0,0);   // right
  };
  GeoBuilder.prototype.toBufferGeometry = function () {
    var THREE = window.__THREE__;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setIndex(this.index);
    geo.computeVertexNormals();
    return geo;
  };

  // ---------------------------------------------------------------- hanging/mounting holes (box-soup, no CSG)
  //
  // A hole is built by NOT filling a small circular region while grid-merging a thin band of the
  // plate (reusing gridRects, same technique as the QR relief itself) — additive-only, no boolean
  // subtraction needed. The band sits in dedicated extra plate height (HOLE_BAND_MM) so it never
  // overlaps the QR/label area, same principle as how labelH already reserves space for text.
  var HOLE_BAND_MM = 12;

  function addPlateWithHoles(builder, size, totalH, thickness, holes, bandBottomY) {
    var bandTopY = totalH / 2;
    // solid body below the perforated band
    builder.addBox(-size / 2, -totalH / 2, 0, size / 2, bandBottomY, thickness);
    var bandH = bandTopY - bandBottomY;
    var cellMM = 0.5;
    var cols = Math.max(4, Math.round(size / cellMM));
    var rows = Math.max(4, Math.round(bandH / cellMM));
    var x0 = -size / 2, y0 = bandBottomY;
    var colW = size / cols, rowH = bandH / rows;
    function on(r, c) {
      var cx = x0 + (c + 0.5) * colW;
      var cy = y0 + (r + 0.5) * rowH;
      for (var i = 0; i < holes.length; i++) {
        var h = holes[i];
        var dx = cx - h.cx, dy = cy - h.cy;
        if (dx * dx + dy * dy <= h.r * h.r) return false;
      }
      return true;
    }
    var rects = gridRects(on, cols, rows);
    rects.forEach(function (rect) {
      var rx0 = x0 + rect.c * colW, rx1 = x0 + (rect.c + rect.w) * colW;
      var ry0 = y0 + rect.r * rowH, ry1 = y0 + (rect.r + rect.h) * rowH;
      builder.addBox(rx0, ry0, 0, rx1, ry1, thickness);
    });
  }

  // ---------------------------------------------------------------- build the full model (base + relief) in mm

  function buildModel(matrix, mask, textGrid) {
    var n = matrix.n;
    var size = obj3d.sizeMM;
    var quiet = size * 0.06;                       // quiet margin around the code
    var def = FORMAT_DEF[obj3d.format];
    var labelH = obj3d.text ? def.labelHeight : 0;
    var labelBand = labelH ? labelH + quiet * 0.4 : 0;
    var hasHoles = !!(def.ringHole || def.wallHoles);
    var holeBand = hasHoles ? HOLE_BAND_MM : 0;
    var depth = size * 0.62; // usable Y depth of the soporte's sloped face (< size: not a square face)

    // The printable code area can't exceed the shortest usable dimension of the face it sits on.
    // For "soporte" that's the wedge depth, not the full plate width — using the wider "size" here
    // (as the code previously did) made the QR spill off the front/back of the sloped face.
    var codeFootprint = obj3d.format === "soporte" ? Math.min(size, depth) : size;
    var codeArea = codeFootprint - quiet * 2;
    var cell = codeArea / n;
    var totalH = size + labelBand + holeBand;
    var thickness = def.thickness || 4;

    var base = new GeoBuilder();
    var relief = new GeoBuilder();

    // ---- base plate ----
    if (obj3d.format === "soporte") {
      // inclined wedge: back edge thick, front edge thin, ~38deg face, small front lip
      var backT = thickness + 14;
      var frontT = thickness;
      base.addWedgeSlab(-size/2, 0, size/2, depth, 0, backT, frontT);
      // small front lip (flat stand) so it doesn't end in a knife edge
      base.addBox(-size/2, depth, 0, size/2, depth + size*0.10, frontT);
    } else if (hasHoles) {
      var holeCy = totalH / 2 - holeBand / 2; // centered in the dedicated top band
      var bandBottomY = totalH / 2 - holeBand;
      var holes = def.ringHole
        ? [{ cx: 0, cy: holeCy, r: 3.0 }]                                              // llavero: 1 centered hole, Ø6mm
        : [{ cx: -size/2 + 6, cy: holeCy, r: 1.6 }, { cx: size/2 - 6, cy: holeCy, r: 1.6 }]; // placa: 2 corner holes, Ø3.2mm
      addPlateWithHoles(base, size, totalH, thickness, holes, bandBottomY);
    } else {
      base.addBox(-size/2, -totalH/2, 0, size/2, totalH/2, thickness);
    }

    // ---- relief: QR modules, styled mask driven, merged into rectangles ----
    var reliefZ0 = obj3d.format === "soporte" ? undefined : thickness - RELIEF_SINK;
    var rects = gridRects(function (r, c) { return mask ? mask.on(r, c) : matrix.isDark(r, c); }, n, n);

    var codeOriginX = -codeArea / 2;
    // Both branches place the code flush against the bottom of its own region (above the label,
    // if any) with a `quiet` margin — the "soporte" region is [0, depth], the flat-plate region
    // is [-totalH/2 + labelBand, -totalH/2 + labelBand + size].
    var codeOriginY = obj3d.format === "soporte"
      ? (depth - codeArea) / 2
      : -totalH / 2 + labelBand + quiet;

    rects.forEach(function (rect) {
      var x0 = codeOriginX + rect.c * cell - 0.01;
      var x1 = codeOriginX + (rect.c + rect.w) * cell + 0.01;
      var yTop = codeOriginY + (n - rect.r) * cell + 0.01;
      var yBot = codeOriginY + (n - rect.r - rect.h) * cell - 0.01;
      if (obj3d.format === "soporte") {
        // project onto the inclined face: approximate with a flat-topped box at avg height (visually fine at this scale)
        var depth = size * 0.62;
        var backT = thickness + 14, frontT = thickness;
        addReliefOnWedge(relief, x0, x1, yBot, yTop, depth, backT, frontT);
      } else {
        relief.addBox(x0, yBot, reliefZ0, x1, yTop, thickness + RELIEF_H);
      }
    });

    // ---- text relief ----
    if (obj3d.text && textGrid) {
      var tCols = textGrid.cols, tRows = textGrid.rows;
      var tRectsSrc = gridRects(textGrid.on, tCols, tRows);
      var textW = size * 0.86;
      var textCell = textW / tCols;
      var textH = textCell * tRows;
      var tx0 = -textW / 2;
      var ty0Center = obj3d.format === "soporte" ? (size * 0.62 - size) / 2 - quiet * 0.2 : -totalH / 2 + quiet * 0.9;
      tRectsSrc.forEach(function (rect) {
        var x0 = tx0 + rect.c * textCell - 0.01;
        var x1 = tx0 + (rect.c + rect.w) * textCell + 0.01;
        var yTop = ty0Center + (tRows - rect.r) * textCell / (tRows/tRows) * (textH / tRows) - textH/2 + 0.01;
        var yBot = ty0Center + (tRows - rect.r - rect.h) * (textH / tRows) - textH/2 - 0.01;
        if (obj3d.format === "soporte") {
          var depth = size * 0.62;
          var backT = thickness + 14, frontT = thickness;
          addReliefOnWedge(relief, x0, x1, yBot, yTop, depth, backT, frontT, true);
        } else {
          relief.addBox(x0, yBot, reliefZ0, x1, yTop, thickness + RELIEF_H);
        }
      });
    }

    function addReliefOnWedge(builder, x0, x1, y0, y1, depth, backT, frontT, isLabel) {
      var slope = (frontT - backT) / depth;
      var zBase0 = backT + slope * y0;
      var zBase1 = backT + slope * y1;
      var zAvgBase = (zBase0 + zBase1) / 2;
      builder.addBox(x0, y0, zAvgBase - RELIEF_SINK, x1, y1, zAvgBase + RELIEF_H);
    }

    var baseGeo = base.toBufferGeometry();
    var reliefGeo = relief.toBufferGeometry();
    return {
      baseGeo: baseGeo, reliefGeo: reliefGeo, totalH: totalH, thickness: thickness, size: size,
      moduleMM: n ? codeArea / n : 0
    };
  }

  // ---------------------------------------------------------------- warnings

  function luminance(hex) {
    var c = hex.replace("#", "");
    var r = parseInt(c.substr(0, 2), 16) / 255, g = parseInt(c.substr(2, 2), 16) / 255, b = parseInt(c.substr(4, 2), 16) / 255;
    function lin(v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function contrastRatio(hexA, hexB) {
    var la = luminance(hexA) + 0.05, lb = luminance(hexB) + 0.05;
    return la > lb ? la / lb : lb / la;
  }

  function updateWarnings(moduleMM) {
    var box = $("#printWarnings");
    if (!box) return;
    moduleMM = moduleMM || 0;
    var contrast = contrastRatio(obj3d.colorBase, obj3d.colorCode);
    var inverted = luminance(obj3d.colorCode) > luminance(obj3d.colorBase);

    var pills = [];
    if (moduleMM < 1.5) {
      pills.push({ ok: false, text: "Módulo de " + moduleMM.toFixed(2) + " mm — agranda la pieza o acorta el enlace (mínimo recomendado: 1,5 mm)." });
    } else {
      pills.push({ ok: true, text: "Módulo de " + moduleMM.toFixed(2) + " mm — buen tamaño para escanear." });
    }
    if (contrast < 3) {
      pills.push({ ok: false, text: "Contraste bajo entre colores (" + contrast.toFixed(1) + ":1) — puede no escanear. Usa una base clara y un código oscuro." });
    } else {
      pills.push({ ok: true, text: "Contraste de " + contrast.toFixed(1) + ":1 — buen contraste para escanear." });
    }
    if (inverted) {
      pills.push({ ok: false, text: "Código más claro que la base — la mayoría de móviles lo leen, algunos antiguos no." });
    }
    box.innerHTML = pills.map(function (p) {
      return '<div class="warn-pill ' + (p.ok ? "is-ok" : "is-bad") + '">' + (p.ok ? "✓" : "⚠") + " " + p.text + "</div>";
    }).join("");
  }

  // ---------------------------------------------------------------- 3MF export

  function toPositiveOctant(baseGeo, reliefGeo) {
    var THREE = window.__THREE__;
    var bp = baseGeo.attributes.position.array, rp = reliefGeo.attributes.position.array;
    var minX = Infinity, minY = Infinity, minZ = Infinity;
    for (var i = 0; i < bp.length; i += 3) { minX = Math.min(minX, bp[i]); minY = Math.min(minY, bp[i+1]); minZ = Math.min(minZ, bp[i+2]); }
    for (var j = 0; j < rp.length; j += 3) { minX = Math.min(minX, rp[j]); minY = Math.min(minY, rp[j+1]); minZ = Math.min(minZ, rp[j+2]); }
    baseGeo.translate(-minX, -minY, -minZ);
    reliefGeo.translate(-minX, -minY, -minZ);
  }

  function geoToXmlMesh(geo) {
    var pos = geo.attributes.position.array;
    var idx = geo.index.array;
    var lines = ["<mesh>", "<vertices>"];
    for (var i = 0; i < pos.length; i += 3) {
      lines.push('<vertex x="' + pos[i].toFixed(4) + '" y="' + pos[i + 1].toFixed(4) + '" z="' + pos[i + 2].toFixed(4) + '"/>');
    }
    lines.push("</vertices>", "<triangles>");
    var triCount = 0;
    for (var t = 0; t < idx.length; t += 3) {
      var a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (a === b || b === c || a === c) continue;
      lines.push('<triangle v1="' + a + '" v2="' + b + '" v3="' + c + '"/>');
      triCount++;
    }
    lines.push("</triangles>", "</mesh>");
    return { xml: lines.join(""), triCount: triCount };
  }

  function hex8(hex) {
    return (hex.startsWith("#") ? hex : "#" + hex).toUpperCase() + "FF";
  }

  function build3mfBlob(model) {
    toPositiveOctant(model.baseGeo, model.reliefGeo);
    var baseMesh = geoToXmlMesh(model.baseGeo);
    var reliefMesh = geoToXmlMesh(model.reliefGeo);

    var modelXml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<model unit="millimeter" xml:lang="es-ES" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
      "<resources>" +
      '<basematerials id="1">' +
      '<base name="Base" displaycolor="' + hex8(obj3d.colorBase) + '"/>' +
      '<base name="Codigo" displaycolor="' + hex8(obj3d.colorCode) + '"/>' +
      "</basematerials>" +
      '<object id="2" type="model" pid="1" pindex="0">' + baseMesh.xml + "</object>" +
      '<object id="3" type="model" pid="1" pindex="1">' + reliefMesh.xml + "</object>" +
      "</resources>" +
      '<build><item objectid="2"/><item objectid="3"/></build>' +
      "</model>";

    var contentTypes = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>';

    var zip = new window.JSZip();
    zip.file("[Content_Types].xml", contentTypes);
    zip.folder("_rels").file(".rels", rels);
    zip.folder("3D").file("3dmodel.model", modelXml);

    return zip.generateAsync({ type: "blob", mimeType: "model/3mf", compression: "DEFLATE" }).then(function (blob) {
      return { blob: blob, baseTri: baseMesh.triCount, reliefTri: reliefMesh.triCount };
    });
  }

  // ---------------------------------------------------------------- STL export (secondary, zipped)

  function buildStlZipBlob(model) {
    return import("three/addons/exporters/STLExporter.js").then(function (mod) {
      var THREE = window.__THREE__;
      var exporter = new mod.STLExporter();
      var baseMesh = new THREE.Mesh(model.baseGeo);
      var reliefMesh = new THREE.Mesh(model.reliefGeo);
      // STLExporter.parse(..., {binary:true}) returns a DataView; JSZip in this
      // vendored version only recognizes typed arrays, not raw DataViews.
      function toU8(dv) { return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength); }
      var baseStl = toU8(exporter.parse(baseMesh, { binary: true }));
      var reliefStl = toU8(exporter.parse(reliefMesh, { binary: true }));
      var zip = new window.JSZip();
      zip.file("base.stl", baseStl);
      zip.file("qr-relieve.stl", reliefStl);
      zip.file("LEEME.txt",
        "Importa ambos archivos (base.stl y qr-relieve.stl) en tu slicer, colócalos en el mismo origen (0,0)\n" +
        "y asigna un filamento/color distinto a cada uno.\n\n" +
        "Si tu slicer admite color por pieza, te recomendamos usar el archivo .3mf en su lugar:\n" +
        "ya trae los dos colores asignados automáticamente.");
      return zip.generateAsync({ type: "blob" });
    });
  }

  // ---------------------------------------------------------------- three.js preview (lazy)

  var viewer = null; // { THREE, scene, camera, renderer, controls, baseMesh, reliefMesh, visible, rafId }
  var threePromise = null;

  // Geometry building (buildModel -> GeoBuilder.toBufferGeometry) needs THREE.BufferGeometry
  // even when only exporting (3MF/STL), independently of whether the on-page WebGL viewer
  // ever initializes. Always resolve the core module first, then reuse it (import() caches
  // by URL, so this never double-fetches when initViewerOnce() imports "three" again).
  function ensureThree() {
    if (window.__THREE__) return Promise.resolve(window.__THREE__);
    if (!threePromise) {
      threePromise = import("three").then(function (THREE) { window.__THREE__ = THREE; return THREE; });
    }
    return threePromise;
  }

  function initViewerOnce() {
    if (viewer) return Promise.resolve(viewer);
    var frame = $("#viewer3dFrame");
    var canvas = $("#viewer3dCanvas");
    if (!frame || !canvas) return Promise.reject(new Error("no viewer frame"));
    if (!window.WebGLRenderingContext) {
      var ph = $("#viewer3dPlaceholder");
      if (ph) ph.textContent = "Tu navegador no soporta vista previa 3D (WebGL). Las descargas siguen funcionando.";
      return Promise.reject(new Error("no webgl"));
    }
    return Promise.all([ensureThree(), import("three/addons/controls/OrbitControls.js")]).then(function (mods) {
      var THREE = mods[0];
      var OrbitControls = mods[1].OrbitControls;

      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
      camera.position.set(0, -140, 130);
      camera.up.set(0, 0, 1);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.15));
      var dir = new THREE.DirectionalLight(0xffffff, 1.1);
      dir.position.set(80, -60, 140);
      scene.add(dir);

      var controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 0, 0);

      var baseMat = new THREE.MeshStandardMaterial({ color: obj3d.colorBase, roughness: 0.55, metalness: 0.05 });
      var reliefMat = new THREE.MeshStandardMaterial({ color: obj3d.colorCode, roughness: 0.5, metalness: 0.05 });
      var baseMesh = new THREE.Mesh(new THREE.BufferGeometry(), baseMat);
      var reliefMesh = new THREE.Mesh(new THREE.BufferGeometry(), reliefMat);
      scene.add(baseMesh, reliefMesh);

      viewer = {
        THREE: THREE, scene: scene, camera: camera, renderer: renderer, controls: controls,
        baseMesh: baseMesh, reliefMesh: reliefMesh, baseMat: baseMat, reliefMat: reliefMat,
        visible: true, lastFormat: null
      };

      function resize() {
        var w = frame.clientWidth || 300, h = frame.clientHeight || 300;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      resize();
      window.addEventListener("resize", resize);

      function loop() {
        requestAnimationFrame(loop);
        if (!viewer.visible || document.hidden) return;
        controls.update();
        renderer.render(scene, camera);
      }
      requestAnimationFrame(loop);

      return viewer;
    });
  }

  function fitCameraToFormat() {
    if (!viewer) return;
    var THREE = viewer.THREE;
    var size = obj3d.sizeMM;
    if (obj3d.format === "soporte") {
      viewer.camera.position.set(0, -size * 1.35, size * 1.05);
      viewer.controls.target.set(0, 0, size * 0.15);
    } else {
      viewer.camera.position.set(0, -size * 0.05, size * 1.55);
      viewer.controls.target.set(0, 0, 0);
    }
    viewer.camera.updateProjectionMatrix();
  }

  var buildGen = 0;
  function rebuildViewerModel() {
    var api = window.__QR__;
    var payload = api.getPayload();
    var opts = api.buildOptions(300, "canvas");
    var thisGen = ++buildGen;

    var srcInst = new window.QRCodeStyling(opts);
    var matrix = readMatrix(srcInst);
    if (!matrix) return;

    var st = api.getState();
    var silhouettePromise = (st.centerType !== "none" && st.centerImage)
      ? makeSilhouetteDataUrl(st.centerImage)
      : Promise.resolve(null);

    silhouettePromise.then(function (silhouette) {
      if (thisGen !== buildGen) return null;
      return buildStyledMask(matrix.n, silhouette);
    }).then(function (mask) {
      if (thisGen !== buildGen || !mask) return;
      return ensureThree().then(function () {
        if (thisGen !== buildGen) return;
        var textGrid = obj3d.text ? textToGrid(obj3d.text, Math.max(40, obj3d.text.length * 9), 16) : null;
        var model = buildModel(matrix, mask, textGrid);
        lastModel = model;
        if (thisGen !== buildGen) return;
        return model;
      });
    }).then(function (model) {
      if (thisGen !== buildGen || !model) return;
      return initViewerOnce().then(function (v) {
        if (thisGen !== buildGen) return;
        v.baseMesh.geometry.dispose();
        v.reliefMesh.geometry.dispose();
        v.baseMesh.geometry = model.baseGeo;
        v.reliefMesh.geometry = model.reliefGeo;
        v.baseMat.color.set(obj3d.colorBase);
        v.reliefMat.color.set(obj3d.colorCode);
        var ph = $("#viewer3dPlaceholder");
        if (ph) ph.style.display = "none";
        if (v.lastFormat !== obj3d.format) { fitCameraToFormat(); v.lastFormat = obj3d.format; }
      }).catch(function () { /* WebGL unavailable — downloads still work */ });
    }).then(function () {
      updateWarnings(lastModel ? lastModel.moduleMM : 0);
    }).catch(function (e) { console.warn("[qr3d rebuild]", e); });
  }

  var lastModel = null;
  var rebuildTimer = null;
  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuildViewerModel, 160);
  }

  function freshModelForExport() {
    var api = window.__QR__;
    var opts = api.buildOptions(300, "canvas");
    var srcInst = new window.QRCodeStyling(opts);
    var matrix = readMatrix(srcInst);
    var st = api.getState();
    var silhouettePromise = (st.centerType !== "none" && st.centerImage)
      ? makeSilhouetteDataUrl(st.centerImage)
      : Promise.resolve(null);
    return silhouettePromise.then(function (silhouette) {
      return buildStyledMask(matrix.n, silhouette);
    }).then(function (mask) {
      return ensureThree().then(function () {
        var textGrid = obj3d.text ? textToGrid(obj3d.text, Math.max(40, obj3d.text.length * 9), 16) : null;
        return buildModel(matrix, mask, textGrid);
      });
    });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    document.dispatchEvent(new CustomEvent("qr:downloaded", { detail: { filename: filename } }));
  }

  function download3mf() {
    var btn = $("#download3mf");
    if (btn) { btn.disabled = true; btn.textContent = "Generando…"; }
    freshModelForExport().then(function (model) {
      return build3mfBlob(model);
    }).then(function (res) {
      saveBlob(res.blob, "qr3d-" + obj3d.format + ".3mf");
      window.__QR3D_LAST_3MF__ = res;
    }).catch(function (e) {
      console.warn("[download3mf]", e);
      alert("No se pudo generar el archivo 3D. Prueba de nuevo.");
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = "Descargar 3MF (2 colores)"; }
    });
  }

  function downloadStl() {
    var btn = $("#downloadStl");
    if (btn) { btn.disabled = true; btn.textContent = "Generando…"; }
    freshModelForExport().then(function (model) {
      return buildStlZipBlob(model);
    }).then(function (blob) {
      saveBlob(blob, "qr3d-" + obj3d.format + "-stl.zip");
    }).catch(function (e) {
      console.warn("[downloadStl]", e);
      alert("No se pudo generar el STL. Prueba de nuevo.");
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.textContent = "Descargar STL (sin color)"; }
    });
  }

  // ---------------------------------------------------------------- background-tab / zero-size guard

  function armVisibilityGuard() {
    var frame = $("#viewer3dFrame");
    if (!frame) return;
    var started = false;
    function tryStart() {
      if (started) return;
      if (window.innerHeight === 0 || !frame.offsetParent) { setTimeout(tryStart, 250); return; }
      started = true;
      scheduleRebuild();
    }
    var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) tryStart(); });
    }, { rootMargin: "200px" }) : null;
    if (io) io.observe(frame); else tryStart();
    document.addEventListener("visibilitychange", function () {
      if (viewer) viewer.visible = !document.hidden;
      if (!document.hidden) tryStart();
    });
    setTimeout(tryStart, 2500); // safety net
  }

  // ---------------------------------------------------------------- init

  function initFormatGrid() {
    $$(".format-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        obj3d.format = btn.dataset.format;
        $$(".format-btn").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        scheduleRebuild();
      });
    });
  }

  function initObject3dFields() {
    var text = $("#obj3dText"), base = $("#obj3dColorBase"), code = $("#obj3dColorCode"), size = $("#obj3dSize"), sizeVal = $("#obj3dSizeValue");
    if (text) text.addEventListener("input", function () { obj3d.text = text.value.trim(); scheduleRebuild(); });
    if (base) base.addEventListener("input", function () { obj3d.colorBase = base.value; if (viewer) viewer.baseMat.color.set(base.value); scheduleRebuild(); });
    if (code) code.addEventListener("input", function () { obj3d.colorCode = code.value; if (viewer) viewer.reliefMat.color.set(code.value); scheduleRebuild(); });
    if (size) size.addEventListener("input", function () {
      obj3d.sizeMM = +size.value;
      if (sizeVal) sizeVal.textContent = size.value;
      scheduleRebuild();
    });
    document.addEventListener("qr3d:colors-changed", function () {
      if (base) obj3d.colorBase = base.value;
      if (code) obj3d.colorCode = code.value;
      if (viewer) { viewer.baseMat.color.set(obj3d.colorBase); viewer.reliefMat.color.set(obj3d.colorCode); }
      scheduleRebuild();
    });
  }

  function boot() {
    var tryInit = function () {
      if (!window.__QR__ || !window.QRCodeStyling || !window.JSZip) { setTimeout(tryInit, 60); return; }
      safe(initFormatGrid, "initFormatGrid");
      safe(initObject3dFields, "initObject3dFields");
      var mfBtn = $("#download3mf"), stlBtn = $("#downloadStl");
      if (mfBtn) mfBtn.addEventListener("click", download3mf);
      if (stlBtn) stlBtn.addEventListener("click", downloadStl);
      window.__QR__.onChange(function () { scheduleRebuild(); });
      safe(armVisibilityGuard, "armVisibilityGuard");
    };
    tryInit();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // exposed for automated verification (DOM/artifact probes, per skill invariant 11)
  window.__QR3D_TEST__ = {
    buildFreshModel: freshModelForExport,
    build3mf: function () { return freshModelForExport().then(build3mfBlob); },
    state: function () { return obj3d; }
  };
})();
