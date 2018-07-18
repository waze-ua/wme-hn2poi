// ==UserScript==
// @name         WME HN2POI
// @version      2018.07.19.001
// @description  Converts HouseNumbers to POI and Residential Point
// @author       turbopirate
// @include      /^https:\/\/(www|beta)\.waze\.com(\/\w{2,3}|\/\w{2,3}-\w{2,3}|\/\w{2,3}-\w{2,3}-\w{2,3})?\/editor\b/
// @grant        none
// @namespace https://greasyfork.org/users/166361
// ==/UserScript==

(function() {
  
  function log(m) { console.log('%cWME HN2POI:%c ' + m, 'color: darkcyan; font-weight: bold', 'color: dimgray; font-weight: normal'); }
  function warn(m) { console.warn('WME HN2POI: ' + m); }
  function err(m) { console.error('WME HN2POI: ' + m); }
  
  const d = window.document;
  const q = d.querySelector.bind(d);
  const qa = d.querySelectorAll.bind(d);
  let sm = null; // Waze Selection Manager

  const locales = {
    en: {
      makePoiButtonText: "House Numbers to POI",
      delHNButtonText: "Delete House Numbers"
    },
    ru: {
      makePoiButtonText: "Номера домов в POI",
      delHNButtonText: "Удалить номера домов"
    },
    ua: {
      makePoiButtonText: "Номера будинків у POI",
      delHNButtonText: "Видалити номера будинків"
    }
  };

  function txt(id) {
    return locales[I18n.locale] === undefined ?  locales['en'][id] : locales[I18n.locale][id];
  }

  // Helper to create dom element with attributes
  function newEl(name, attrs) {
    const el = d.createElement(name);
    for (let attr in attrs) if (el[attr] !== undefined) el[attr] = attrs[attr];
    return el;
  }

  function wait() {
    if (!W || !W.map || !W.model) {
        setTimeout(wait, 1000);
        log('Waiting Waze...');
        return;
    }
    log("Ready...");
    init();
  };

  function init() {
    sm = W.selectionManager;
    sm.events.register("selectionchanged", null, onSelect);
  }

  function onSelect() {
    const fts = sm.getSelectedFeatures();
    
    if (!fts || fts.length === 0 || fts[0].model.type !== "segment" || !fts.some(f => f.model.attributes.hasHNs)) return;

    const makePoiBtn = newEl('button', {className: 'waze-btn waze-btn-white action-button', style: 'display: inline-block', innerText: txt('makePoiButtonText')});
    q('#edit-panel .more-actions').appendChild(makePoiBtn);
    makePoiBtn.addEventListener('click', makePoi);

    const delHNbtn = newEl('button', {className: 'waze-btn waze-btn-white action-button', style: 'display: inline-block', innerText: txt('delHNButtonText')});
    q('#edit-panel .more-actions').appendChild(delHNbtn);
    delHNbtn.addEventListener('click', delHN);
  }
  
  function makePoi() {
    const fts = sm.getSelectedFeatures();
    
    if (!fts || fts.length === 0 || fts[0].model.type !== "segment" || !fts.some(f => f.model.attributes.hasHNs)) return;

    const Landmark = require('Waze/Feature/Vector/Landmark');
    const AddLandmark = require('Waze/Action/AddLandmark');
    const HouseNumberAction = require('Waze/Action/HouseNumber');
    const UpdateFeatureAddress = require('Waze/Action/UpdateFeatureAddress');
    const segs = [];

    // get all segments ids with HN
    fts.forEach(f => {
      if (!f.model.attributes.hasHNs)
        return;
      segs.push(f.model.attributes.id);
    });
    
    // NOTE:
    // Get HNs info only for array of segments, otherwise Waze api
    // for some reason doesn't responds properly
    W.model.houseNumbers.get(segs).then(i => {
      i.forEach(hn => {
        hn.numbers.forEach(num => {
          const poi = new Landmark();
          poi.geometry = num.geometry.clone();
          poi.attributes.name = num.number;
          poi.attributes.houseNumber = num.number;
          poi.attributes.categories.push('OTHER');
          W.model.actionManager.add(new AddLandmark(poi));
          const addr = W.model.segments.objects[hn.id].getAddress();
          const newAddr = {
            countryID: addr.attributes.country.id,
            stateID: addr.attributes.state.id,
            cityName: addr.attributes.city.attributes.name,
            emptyCity: !1,
            streetName: addr.attributes.street.name,
            streetEmpty: !1,
          };
          addr.houseNumber = num.number;
          W.model.actionManager.add(new UpdateFeatureAddress(poi, newAddr));
        });
      });
    });
  }

  function delHN() {
    const fts = sm.getSelectedFeatures();
    
    if (!fts || fts.length === 0 || fts[0].model.type !== "segment" || !fts.some(f => f.model.attributes.hasHNs)) return;

    const HouseNumberAction = require('Waze/Action/HouseNumber');
    const segs = [];

    fts.forEach(f => {
      if (!f.model.attributes.hasHNs)
        return;
      segs.push(f.model.attributes.id);
    });

    W.model.houseNumbers.get(segs).then(i => {
      i.forEach(hn =>
        hn.numbers.forEach(num =>
          W.model.actionManager.add(new HouseNumberAction.DeleteHouseNumber(num.parent, num))
        )
      );
    });
  }
  
  wait();
})();
