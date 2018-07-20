// ==UserScript==
// @name         WME HN2POI
// @version      2018.07.20.002
// @description  Converts HouseNumbers to POI
// @author       turbopirate
// @include      /^https:\/\/(www|beta)\.waze\.com(\/\w{2,3}|\/\w{2,3}-\w{2,3}|\/\w{2,3}-\w{2,3}-\w{2,3})?\/editor\b/
// @grant        none
// @namespace https://greasyfork.org/users/166361
// @require https://greasyfork.org/scripts/16071-wme-keyboard-shortcuts/code/WME%20Keyboard%20Shortcuts.js
// ==/UserScript==

(function() {
  
  function log(m) { console.log('%cWME HN2POI:%c ' + m, 'color: darkcyan; font-weight: bold', 'color: dimgray; font-weight: normal'); }
  function warn(m) { console.warn('WME HN2POI: ' + m); }
  function err(m) { console.error('WME HN2POI: ' + m); }
  
  const d = window.document;
  const q = d.querySelector.bind(d);
  const qa = d.querySelectorAll.bind(d);
  let sm = null; // Waze Selection Manager
  let settings = {};
  const locales = {
    en: {
      makePoiButtonText: 'HN → POI',
      delHNButtonText: "Delete HN",
      addResidentialLabel: 'Add residential POI',
      noDuplicatesLabel: 'No POI duplicates'
    },
    ru: {
      makePoiButtonText: 'HN → POI',
      delHNButtonText: 'Удалить HN',
      addResidentialLabel: 'Добавлять адресную точку',
      noDuplicatesLabel: 'Без дубликатов POI'
    },
    uk: {
      makePoiButtonText: 'HN → POI',
      delHNButtonText: 'Видалити HN',
      addResidentialLabel: 'Додавати адресну точку',
      noDuplicatesLabel: 'Без дублікатів POI'
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
    
    const tabPaneContent = [
      '<p>WME HN2POI</p>',
      `<div><input type="checkbox" id="hn2poi-add-residential" /><label for="hn2poi-add-residential">${txt('addResidentialLabel')}</label></div>`,
      `<div><input type="checkbox" id="hn2poi-no-duplicates" /><label for="hn2poi-no-duplicates">${txt('noDuplicatesLabel')}</label></div>`,
    ].join('');
    
    const tabPane = newEl('div', {id: 'sidepanel-hn2poi', className: 'tab-pane', innerHTML: tabPaneContent});
    
    q('.nav-tabs').appendChild(newEl('li', {innerHTML: '<a href="#sidepanel-hn2poi" data-toggle="tab">HN2POI</a>'}));
    q('#user-info .tab-content').appendChild(tabPane);
    
    const s = localStorage['hn2poi'];
    settings = s ? JSON.parse(s) : { addResidential: false, noDuplicates: true };

    const addResidentialInput = q('#hn2poi-add-residential');
    const noDuplicatesInput = q('#hn2poi-no-duplicates');
    
    addResidentialInput.checked = settings.addResidential;
    addResidentialInput.addEventListener('change', updateSettings);
    noDuplicatesInput.checked = settings.noDuplicates;
    noDuplicatesInput.addEventListener('change', updateSettings);
    
    const scriptName = 'hn2poi';

    WMEKSRegisterKeyboardShortcut(scriptName, 'HN2POI', 'hn-to-poi', txt('makePoiButtonText'), makePOI, '-1');
    WMEKSRegisterKeyboardShortcut(scriptName, 'HN2POI', 'delete-hn', txt('delHNButtonText'), delHN, '-1');
    WMEKSLoadKeyboardShortcuts(scriptName);

    window.addEventListener("beforeunload", function() {
        WMEKSSaveKeyboardShortcuts(scriptName);
    }, false);
  }

  function updateSettings() {
    settings.addResidential = q('#hn2poi-add-residential').checked;
    settings.noDuplicates = q('#hn2poi-no-duplicates').checked;
    localStorage['hn2poi'] = JSON.stringify(settings);
  }
  
  function onSelect() {
    const fts = sm.getSelectedFeatures();
    
    if (!fts || fts.length === 0 || fts[0].model.type !== "segment" || !fts.some(f => f.model.attributes.hasHNs)) return;

    const pane = newEl('div', {className: 'form-group'});
    const makePoiBtn = newEl('button', {className: 'waze-btn waze-btn-white action-button', style: 'display: inline-block', innerText: txt('makePoiButtonText')});
    const delHNbtn = newEl('button', {className: 'waze-btn waze-btn-white action-button', style: 'display: inline-block', innerText: txt('delHNButtonText')});

    makePoiBtn.addEventListener('click', makePOI);
    delHNbtn.addEventListener('click', delHN);
    
    pane.appendChild(makePoiBtn);
    pane.appendChild(delHNbtn);

    q('#edit-panel .tab-pane').insertBefore(pane, q('#edit-panel .tab-pane .more-actions'));
  }
  
  function hasDuplicates(poi, addr) {
    const venues = W.model.venues.objects;
    for (let k in venues)
      if (venues.hasOwnProperty(k)) {
        const otherPOI = venues[k];
        const otherAddr = otherPOI.getAddress().attributes;
        if (
          poi.attributes.name == otherPOI.attributes.name
          && poi.attributes.houseNumber == otherPOI.attributes.houseNumber
          && poi.attributes.residential == otherPOI.attributes.residential
          && addr.street.name == otherAddr.street.name
          && addr.city.attributes.name == otherAddr.city.attributes.name
          && addr.country.name == otherAddr.country.name
          )
          return true; // This is duplicate
      }
    return false;
  }
  
  function makePOI() {
    const fts = sm.getSelectedFeatures();
    
    if (!fts || fts.length === 0 || fts[0].model.type !== "segment" || !fts.some(f => f.model.attributes.hasHNs)) return;

    const Landmark = require('Waze/Feature/Vector/Landmark');
    const AddLandmark = require('Waze/Action/AddLandmark');
    const HouseNumberAction = require('Waze/Action/HouseNumber');
    const UpdateFeatureAddress = require('Waze/Action/UpdateFeatureAddress');
    const segs = [];

    // collect all segments ids with HN
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
          
          let addPOI = true;

          const poi = new Landmark();
          poi.geometry = num.geometry.clone();
          poi.attributes.name = num.number;
          poi.attributes.houseNumber = num.number;
          poi.attributes.categories.push('OTHER');

          const addr = W.model.segments.get(hn.id).getAddress().attributes;

          const newAddr = {
            countryID: addr.country.id,
            stateID: addr.state.id,
            cityName: addr.city.attributes.name,
            emptyCity: !1,
            streetName: addr.street.name,
            streetEmpty: !1,
          };

          if (settings.noDuplicates && hasDuplicates(poi, addr))
            addPOI = false;
          
          if (addPOI) {
            W.model.actionManager.add(new AddLandmark(poi));
            W.model.actionManager.add(new UpdateFeatureAddress(poi, newAddr));
          }
          
          if (!settings.addResidential)
            return; // no residential required
          
          const res = new Landmark();
          res.geometry = num.geometry.clone();
          res.geometry.x += 10;
          res.attributes.residential = true;
          res.attributes.houseNumber = num.number;

          if (settings.noDuplicates && hasDuplicates(res, addr))
            return;          
          
          W.model.actionManager.add(new AddLandmark(res));
          W.model.actionManager.add(new UpdateFeatureAddress(res, newAddr));

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
