// ==UserScript==
// @name         WME HN2POI
// @version      2022.08.21.01
// @description  Converts HouseNumbers to POI
// @author       turbopirate, Andrei Pavlenko
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

  function initUI() {
    const tabs = q('.nav-tabs'), tabContent = q('#user-info .tab-content');

    if (!tabs || !tabContent) {
      log('Waze UI not ready...');
      setTimeout(initUI, 500);
      return;
    }

    const tabPaneContent = [
      '<p>WME HN2POI</p>',
      `<div><input type="checkbox" id="hn2poi-add-residential" /><label for="hn2poi-add-residential">${txt('addResidentialLabel')}</label></div>`,
      `<div><input type="checkbox" id="hn2poi-no-duplicates" /><label for="hn2poi-no-duplicates">${txt('noDuplicatesLabel')}</label></div>`,
    ].join('');

    const tabPane = newEl('div', {id: 'sidepanel-hn2poi', className: 'tab-pane', innerHTML: tabPaneContent});

    tabs.appendChild(newEl('li', {innerHTML: '<a href="#sidepanel-hn2poi" data-toggle="tab">HN2POI</a>'}));
    tabContent.appendChild(tabPane);

    const s = localStorage['hn2poi'];
    settings = s ? JSON.parse(s) : { addResidential: false, noDuplicates: true };

    const addResidentialInput = q('#hn2poi-add-residential');
    const noDuplicatesInput = q('#hn2poi-no-duplicates');

    addResidentialInput.checked = settings.addResidential;
    addResidentialInput.addEventListener('change', updateSettings);
    noDuplicatesInput.checked = settings.noDuplicates;
    noDuplicatesInput.addEventListener('change', updateSettings);

    log('UI initialized...');
  }

  function init() {
    sm = W.selectionManager;
    sm.events.register("selectionchanged", null, onSelect);
    W.editingMediator.on('change:editingHouseNumbers', onEditingHN);

    const scriptName = 'hn2poi';

    RegisterKeyboardShortcut(scriptName, 'HN2POI', 'hn-to-poi', txt('makePoiButtonText'), makePOI, '-1');
    RegisterKeyboardShortcut(scriptName, 'HN2POI', 'delete-hn', txt('delHNButtonText'), delHN, '-1');
    LoadKeyboardShortcuts(scriptName);

    window.addEventListener("beforeunload", function() {
        SaveKeyboardShortcuts(scriptName);
    }, false);

    initUI();
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
    makePoiBtn.addEventListener('click', makePOI);
    pane.appendChild(makePoiBtn);
    q('#segment-edit-general .form-group.more-actions').appendChild(pane);
  }

  // Executes when hn edit mode enabled
  function onEditingHN() {
    const delHNbtn = newEl('div', {className: 'toolbar-button', style: 'float: left', innerText: txt('delHNButtonText')});
    delHNbtn.addEventListener('click', delHN);
    setTimeout(() => {
      $('#app-head #primary-toolbar > div').append(delHNbtn);
    }, 500)
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
    selectEntireStreet();

    const fts = sm.getSelectedFeatures();
    if (!fts || fts.length === 0 || fts[0].model.type !== "segment" || !fts.some(f => f.model.attributes.hasHNs)) return;

    // collect all segments ids with HN
    const segs = [];
    fts.forEach(f => {
      if (!f.model.attributes.hasHNs)
        return;
      segs.push(f.model.attributes.id);
    });

    fetch(`https://www.waze.com/row-Descartes/app/HouseNumbers?ids=${segs.join(',')}`)
    .then(response => response.json())
    .then(json => {
      json.segmentHouseNumbers.objects.forEach(makePOIForHN);
    });
  }

  function makePOIForHN(hn) {
    const Landmark = require('Waze/Feature/Vector/Landmark');
    const AddLandmark = require('Waze/Action/AddLandmark');
    const UpdateFeatureAddress = require('Waze/Action/UpdateFeatureAddress');

    let addPOI = true;

    let [x, y] = hn.geometry.coordinates;
    let poiGeometry = OpenLayers.Projection.transform(
      new OpenLayers.Geometry.Point(x, y),
      'EPSG:4326',
      'EPSG:900913'
    );

    const poi = new Landmark();
    poi.geometry = poiGeometry;
    poi.attributes.name = hn.number;
    poi.attributes.houseNumber = hn.number;
    poi.attributes.categories.push('OTHER');
    poi.attributes.lockRank = getPointLockRank();
    addEntryPoint(poi);

    const addr = W.model.segments.getObjectById(hn.segID).getAddress().attributes;

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
    res.geometry = poiGeometry.clone();
    res.geometry.x += 5;
    res.attributes.residential = true;
    res.attributes.houseNumber = hn.number;
    res.attributes.lockRank = getPointLockRank();
    addEntryPoint(res);

    if (settings.noDuplicates && hasDuplicates(res, addr))
      return;

    W.model.actionManager.add(new AddLandmark(res));
    W.model.actionManager.add(new UpdateFeatureAddress(res, newAddr));
  }

  function delHN() {
    selectEntireStreet();

    const fts = sm.getSelectedFeatures();

    if (!fts || fts.length === 0 || fts[0].model.type !== "segment" || !fts.some(f => f.model.attributes.hasHNs)) return;

    const DeleteHouseNumberAction = require('Waze/Actions/DeleteHouseNumber');
    const segs = [];
    const houseNumbers = W.model.segmentHouseNumbers.getObjectArray();

    fts.forEach(f => {
      if (!f.model.attributes.hasHNs)
        return;
      segs.push(f.model.attributes.id);
    });

    segs.forEach(segID => {
      houseNumbers.forEach(hn => {
        if (hn.getSegmentId() == segID) {
          W.model.actionManager.add(new DeleteHouseNumberAction(hn));
        }
      });
    });
  }

  function addEntryPoint(newPoint) {
    entryPoint = new NavigationPoint(newPoint.geometry.clone());
    newPoint.attributes.entryExitPoints.push(entryPoint);
  }

  function getPointLockRank() {
    const userRank = W.loginManager.user.rank;
    if (userRank >= 1) {
        return 1;
    } else {
        return 0;
    }
  }

  function selectEntireStreet() {
    let selectedFeature = sm.getSelectedFeatures()[0];
    if (selectedFeature) {
      let featureStreetId = selectedFeature.model.attributes.primaryStreetID;
      let sameStreetSegments = W.model.segments.getByAttributes({ primaryStreetID: featureStreetId });

      W.selectionManager.unselectAll();
      W.selectionManager.setSelectedModels(sameStreetSegments);
    }
  }

  //setup keyboard shortcut's header and add a keyboard shortcuts
  function RegisterKeyboardShortcut(ScriptName, ShortcutsHeader, NewShortcut, ShortcutDescription, FunctionToCall, ShortcutKeysObj) {
    // Figure out what language we are using
    var language = I18n.currentLocale();
    //check for and add keyboard shourt group to WME
    try {
        var x = I18n.translations[language].keyboard_shortcuts.groups[ScriptName].members.length;
    } catch (e) {
        //setup keyboard shortcut's header
        W.accelerators.Groups[ScriptName] = []; //setup your shortcut group
        W.accelerators.Groups[ScriptName].members = []; //set up the members of your group
        I18n.translations[language].keyboard_shortcuts.groups[ScriptName] = []; //setup the shortcuts text
        I18n.translations[language].keyboard_shortcuts.groups[ScriptName].description = ShortcutsHeader; //Scripts header
        I18n.translations[language].keyboard_shortcuts.groups[ScriptName].members = []; //setup the shortcuts text
    }
    //check if the function we plan on calling exists
    if (FunctionToCall && (typeof FunctionToCall == "function")) {
        I18n.translations[language].keyboard_shortcuts.groups[ScriptName].members[NewShortcut] = ShortcutDescription; //shortcut's text
        W.accelerators.addAction(NewShortcut, {
            group: ScriptName
        }); //add shortcut one to the group
        //clear the short cut other wise the previous shortcut will be reset MWE seems to keep it stored
        var ClearShortcut = '-1';
        var ShortcutRegisterObj = {};
        ShortcutRegisterObj[ClearShortcut] = NewShortcut;
        W.accelerators._registerShortcuts(ShortcutRegisterObj);
        if (ShortcutKeysObj !== null) {
            //add the new shortcut
            ShortcutRegisterObj = {};
            ShortcutRegisterObj[ShortcutKeysObj] = NewShortcut;
            W.accelerators._registerShortcuts(ShortcutRegisterObj);
        }
        //listen for the shortcut to happen and run a function
        W.accelerators.events.register(NewShortcut, null, function() {
            FunctionToCall();
        });
    } else {
        alert('The function ' + FunctionToCall + ' has not been declared');
    }

  }
  //if saved load and set the shortcuts
  function LoadKeyboardShortcuts(ScriptName) {
	if (localStorage[ScriptName + 'KBS']) {
		var LoadedKBS = JSON.parse(localStorage[ScriptName + 'KBS']); //JSON.parse(localStorage['WMEAwesomeKBS']);
		for (var i = 0; i < LoadedKBS.length; i++) {
			W.accelerators._registerShortcuts(LoadedKBS[i]);
		}
	}
  }

  function SaveKeyboardShortcuts(ScriptName) {
	var TempToSave = [];
	for (var name in W.accelerators.Actions) {
		var TempKeys = "";
		if (W.accelerators.Actions[name].group == ScriptName) {
			if (W.accelerators.Actions[name].shortcut) {
				if (W.accelerators.Actions[name].shortcut.altKey === true) {
					TempKeys += 'A';
				}
				if (W.accelerators.Actions[name].shortcut.shiftKey === true) {
					TempKeys += 'S';
				}
				if (W.accelerators.Actions[name].shortcut.ctrlKey === true) {
					TempKeys += 'C';
				}
				if (TempKeys !== "") {
					TempKeys += '+';
				}
				if (W.accelerators.Actions[name].shortcut.keyCode) {
					TempKeys += W.accelerators.Actions[name].shortcut.keyCode;
				}
			} else {
				TempKeys = "-1";
			}
			var ShortcutRegisterObj = {};
			ShortcutRegisterObj[TempKeys] = W.accelerators.Actions[name].id;
			TempToSave[TempToSave.length] = ShortcutRegisterObj;
		}
	}
	localStorage[ScriptName + 'KBS'] = JSON.stringify(TempToSave);
  }

/// Examples

/*
//add two short cuts
WMERegisterKeyboardShortcut('WMEAwesome', 'WME Awesome Script', 'AwesomeShortcut1', 'Awesome Descrption 1', WMEKyboardShortcutToCall, '-1'); //shortcut1
WMERegisterKeyboardShortcut('WMEAwesome', 'WME Awesome Script',	'AwesomeShortcut2', 'Awesome Descrption 2', WMEKyboardShortcutToCall, '-1'); //shortcut1
WMERegisterKeyboardShortcut('WMEAwesome', 'WME Awesome Script',	'AwesomeShortcut3', 'Awesome Descrption 3', WMEKyboardShortcutToCall, 'ASC+l'); //shortcut1
//WMERegisterKeyboardShortcut('WMEAwesome','AwesomeShortcut2','Awesome Descrption 2',doesnotexist,'-1'); //fuction does not exist


//load the saved shortcuts
WMELoadKeyboardShortcuts('WMEAwesome');

//before unloading WME save the shortcuts
window.addEventListener("beforeunload", function() {
	WMESaveKeyboardShortcuts('WMEAwesome');
}, false);

//displays all of the shortcuts in the console
//W.accelerators.Actions;

//saved shortcuts to console
//JSON.parse(localStorage['WMEAwesomeKBS']);

*/

  var _createClass=function(){function a(b,c){for(var f,d=0;d<c.length;d++)f=c[d],f.enumerable=f.enumerable||!1,f.configurable=!0,"value"in f&&(f.writable=!0),Object.defineProperty(b,f.key,f)}return function(b,c,d){return c&&a(b.prototype,c),d&&a(b,d),b}}();function _classCallCheck(a,b){if(!(a instanceof b))throw new TypeError("Cannot call a class as a function")}var NavigationPoint=function(){function a(b){_classCallCheck(this,a),this._point=b.clone(),this._entry=!0,this._exit=!0,this._isPrimary=!0,this._name=""}return _createClass(a,[{key:"with",value:function _with(){var b=0<arguments.length&&void 0!==arguments[0]?arguments[0]:{};return null==b.point&&(b.point=this.toJSON().point),new this.constructor((this.toJSON().point,b.point))}},{key:"getPoint",value:function getPoint(){return this._point.clone()}},{key:"getEntry",value:function getEntry(){return this._entry}},{key:"getExit",value:function getExit(){return this._exit}},{key:"getName",value:function getName(){return this._name}},{key:"isPrimary",value:function isPrimary(){return this._isPrimary}},{key:"toJSON",value:function toJSON(){return{point:this._point,entry:this._entry,exit:this._exit,primary:this._isPrimary,name:this._name}}},{key:"clone",value:function clone(){return this.with()}}]),a}();
  wait();
})();
