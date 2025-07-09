// popup.js – повна версія з «гнучким» перемикачем профілів
// --------------------------------------------------------------
//  ▸ керує лише тими cookie, що явно вказані у profileData
//  ▸ при перемиканні:
//      1. видаляє ВСІ керовані куки
//      2. додає куки з цільового профілю (якщо вони є)
//  ▸ profileData ніколи не переписується автоматично
// --------------------------------------------------------------

var debugMode = false;

// CONSOLE LOG CONTROLLER
function debugLog(logData) {
	if (debugMode) console.log(logData);
}

// --------------------------------------------------------------
// DOMAIN HELPERS
// --------------------------------------------------------------
function getHostName(url) {
	const match = url.match(/:\/\/(www[0-9]?\.)?([^/:]+)/i);
	return match && match[2] ? match[2] : null;
}

function getDomain(url) {
	const hostName = getHostName(url);
	if (!hostName) return url;

	const parts = hostName.split('.').reverse();
	if (parts.length > 2 && hostName.toLowerCase().includes('.co.uk')) {
		return parts[2] + '.' + parts[1] + '.' + parts[0];
	}
	return parts[1] + '.' + parts[0];
}

// --------------------------------------------------------------
// PROFILE UTILS
// --------------------------------------------------------------
/**
 * Повертає масив унікальних імен cookie, описаних у всіх профілях домену.
 */
function getManagedCookieNames(profileStore, domain) {
	const profiles = (profileStore[domain] || {}).profileData || {};
	const set = new Set();
	Object.values(profiles).forEach(arr => {
		if (Array.isArray(arr)) arr.forEach(c => set.add(c.name));
	});
	return [...set];
}

// --------------------------------------------------------------
// PROFILE CRUD (edit / save / remove / create)
// --------------------------------------------------------------
function addProfileListeners() {
	['changeProfile', 'editProfile', 'removeProfile'].forEach(cls => {
		document.querySelectorAll('.' + cls).forEach(el => {
			el.addEventListener('click', window[cls], false);
		});
	});
	document.getElementById('profileCreate_button').addEventListener('click', newProfile, false);
}

function editProfile(event) {
	const target = event.target;
	$(target).html('save');
	$(target).closest('tr').find('.changeProfile, .profileLabel').hide();
	$(target).closest('tr').find('input').show();
	target.removeEventListener('click', editProfile, false);
	target.addEventListener('click', saveProfileName, false);
}

function saveProfileName(event) {
	const target = event.target;
	const newName = $(target).closest('tr').find('input').val();
	const oldName = target.getAttribute('data-profileName');
	const currentDomain = $('#domain_label').text();

	chrome.storage.local.get('profiles', items => {
		const profiles = items.profiles || {};
		const domObj = profiles[currentDomain] || { currentProfile: 'Profile 1', profileData: { 'Profile 1': [] } };

		if (newName && newName !== oldName) {
			domObj.profileData[newName] = domObj.profileData[oldName];
			delete domObj.profileData[oldName];
			if (domObj.currentProfile === oldName) domObj.currentProfile = newName;
			profiles[currentDomain] = domObj;
			chrome.storage.local.set({ profiles }, loadProfiles);
		}
	});
}

function removeProfile(event) {
	const nameToRemove = event.target.getAttribute('data-profileName');
	const domain = $('#domain_label').text();
	chrome.storage.local.get('profiles', items => {
		const profiles = items.profiles || {};
		if (!profiles[domain]) return;

		delete profiles[domain].profileData[nameToRemove];
		if (profiles[domain].currentProfile === nameToRemove) {
			profiles[domain].currentProfile = Object.keys(profiles[domain].profileData)[0] || '';
		}
		chrome.storage.local.set({ profiles }, () => {
			if ($('#profile_label').text() === nameToRemove) {
				changeProfile({ target: { innerHTML: profiles[domain].currentProfile } });
			}
			loadProfiles();
		});
	});
}

function newProfile() {
	const domain = $('#domain_label').text();
	const newName = $('#profileName_input').val().trim();
	if (!newName) return;

	chrome.storage.local.get('profiles', items => {
		const profiles = items.profiles || {};
		const domObj = profiles[domain] || { currentProfile: 'Profile 1', profileData: { 'Profile 1': [] } };

		domObj.profileData[newName] = [];
		profiles[domain] = domObj;
		chrome.storage.local.set({ profiles }, loadProfiles);
	});
}

// --------------------------------------------------------------
// ГОЛОВНА ФУНКЦІЯ ПЕРЕМИКАННЯ ПРОФІЛІВ
// --------------------------------------------------------------
function changeProfile(event) {
	const targetProfile = event.target.innerHTML;
	const domain = $('#domain_label').text();

	chrome.storage.local.get('profiles', items => {
		const store = items.profiles || {};

		// 1) які куки керовані?
		const managed = getManagedCookieNames(store, domain);

		// 2) видалити їх у поточному домені (+ піддомен b2b.)
		managed.forEach(name => {
			['http://', 'https://'].forEach(proto => {
				chrome.cookies.remove({ url: proto + domain + '/', name });
				chrome.cookies.remove({ url: proto + 'b2b.' + domain + '/', name });
			});
		});

		// 3) додати куки з цільового профілю
		const newCookies = (store[domain]?.profileData[targetProfile] || []);
		newCookies.forEach(c => {
			const cookieObj = {
				...c,
				url: 'http' + (c.secure ? 's' : '') + '://' + c.domain.replace(/^\./, '')
			};
			delete cookieObj.hostOnly;
			delete cookieObj.session;
			chrome.cookies.set(cookieObj);
		});

		// 4) зафіксувати активний профіль (profileData НЕ трогаємо)
		store[domain] = store[domain] || { profileData: {} };
		store[domain].currentProfile = targetProfile;
		chrome.storage.local.set({ profiles: store }, loadProfiles);

		// 5) перезавантажити вкладку, щоб бекенд одразу побачив зміни
		chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
			if (tabs[0]) chrome.tabs.reload(tabs[0].id);
		});
	});
}

// --------------------------------------------------------------
// ІНШІ ДРІБНІ ФУНКЦІЇ (loadProfiles, ініціалізація тощо)
// --------------------------------------------------------------
let origProfileTable = '';

function loadProfiles() {
	if (!origProfileTable) origProfileTable = $('#profileTable').html();
	else $('#profileTable').html(origProfileTable);

	const domain = $('#domain_label').text();
	chrome.storage.local.get('profiles', items => {
		const domObj = (items.profiles || {})[domain] || { currentProfile: 'Profile 1', profileData: { 'Profile 1': [] } };

		$('#profile_label').text(domObj.currentProfile);

		// рендеримо таблицю профілів
		Object.keys(domObj.profileData).forEach(name => {
			const tbody = document.getElementById('profileTable').querySelector('tbody');
			const row = tbody.insertRow(tbody.rows.length - 1);

			const cell1 = row.insertCell(0);
			const txtInput = document.createElement('input');
			txtInput.hidden = true;
			txtInput.value = name;
			cell1.appendChild(txtInput);

			if (name === domObj.currentProfile) {
				const span = document.createElement('a');
				span.className = 'profileLabel';
				span.textContent = name;
				cell1.appendChild(span);
			} else {
				const link = document.createElement('a');
				link.href = '#';
				link.className = 'changeProfile';
				link.textContent = name;
				cell1.appendChild(link);
			}

			const cell2 = row.insertCell(1);
			cell2.className = 'no-wrap';

			const edit = document.createElement('a');
			edit.href = '#';
			edit.className = 'editProfile';
			edit.setAttribute('data-profileName', name);
			edit.textContent = 'edit';

			const remove = document.createElement('a');
			remove.href = '#';
			remove.className = 'removeProfile';
			remove.setAttribute('data-profileName', name);
			remove.textContent = 'remove';

			const spanWrap = document.createElement('span');
			spanWrap.className = 'smallText';
			spanWrap.appendChild(edit);
			spanWrap.appendChild(document.createTextNode(' '));
			spanWrap.appendChild(remove);
			cell2.appendChild(spanWrap);
		});

		if (document.querySelectorAll('#profileTable tbody tr').length < 4) {
			const firstRemove = document.querySelector('#profileTable .removeProfile');
			if (firstRemove) firstRemove.remove();
		}

		addProfileListeners();
	});
}

// --------------------------------------------------------------
// INIT
// --------------------------------------------------------------
function domainLoaded() {
	document.getElementById('domain_label').textContent = currentDomain;
}

let url, currentDomain;

function init() {
	chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
		url = tabs[0].url;
		currentDomain = getDomain(url);
		domainLoaded();
		loadProfiles();
	});
}

document.addEventListener('DOMContentLoaded', init);
