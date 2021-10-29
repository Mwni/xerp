(function () {
	'use strict';

	/*! For license information please see xrpl-latest-min.js.LICENSE.txt */
	var xrpl$1 = xrpl;

	function wait(ms){
		return new Promise(resolve => setTimeout(resolve, ms))
	}

	async function encrypt(str, password){
		let encoder = new TextEncoder();
		let key = await deriveKey(password);
		let encrypted = await crypto.subtle.encrypt(
			{
				name: 'AES-CTR',
				length: 64,
				counter: new Uint8Array(16)
			},
			key,
			encoder.encode(str)
		);

		return buffer2hex(encrypted)
	}

	async function decrypt(hex, password){
		let decoder = new TextDecoder();
		let key = await deriveKey(password);
		let decrypted = await crypto.subtle.decrypt(
			{
				name: 'AES-CTR',
				length: 64,
				counter: new Uint8Array(16)
			},
			key,
			hex2buffer(hex)
		);

		return decoder.decode(decrypted)
	}


	async function deriveKey(password){
		let encoder = new TextEncoder();
		let material = await crypto.subtle.importKey(
			'raw', 
			encoder.encode(password), 
			'PBKDF2', 
			false, 
			['deriveKey']
		);
		
		return await crypto.subtle.deriveKey(
			{
				name: 'PBKDF2',
				salt: encoder.encode('no-salt'),
				iterations: 1,
				hash: 'SHA-256'
			},
			material,
			{
				name: 'AES-CTR', 
				length: 256
			},
			true,
			[
				'encrypt',
				'decrypt'
			]
		)
	}


	function buffer2hex(buffer) {
		return [...new Uint8Array(buffer)]
			.map(x => x.toString(16).padStart(2, '0'))
			.join('')
			.toUpperCase()
	}

	function hex2buffer(hex){
		return new Uint8Array(hex.match(/[\da-f]{2}/gi).map((h) => parseInt(h, 16)))
	}

	const defaultXRPLNode = 'wss://s1.ripple.com';

	class Daemon{
		constructor(){
			this.pstates = {};
			this.xrpl = new xrpl$1.Client(defaultXRPLNode);

			chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));
		}

		handleMessage(message, sender, reply){
			this.serveRequest(message)
				.then(payload => reply({success: true, payload}))
				.catch(error => reply({success: false, error: {message: error.message}}));

			return true
		}

		async serveRequest(payload){
			switch(payload.type){
				case 'has-wallets':
					return !!await this.getFromStorage('wallets')

				case 'get-wallets':
					return await this.getUnlockedWalletsWithoutSeeds(payload.passcode)

				case 'add-wallet':
					await this.addWallet(payload.wallet, payload.passcode);
					break

				case 'get-appstate':
					return this.appstate

				case 'set-appstate':
					this.appstate = payload.state;
					this.rescheduleAppStateExpiry();
					break

				case 'derive-address':
					return xrpl$1.Wallet.fromSeed(payload.seed).address

				case 'get-xrp-balance':
					await this.needXRPL();

					try{
						return await this.xrpl.getXrpBalance(payload.address)
					}catch{
						return NaN
					}

				case 'get-balances':
					await this.needXRPL();

					return await this.xrpl.getBalances(payload.address)

			}
		}

		async getUnlockedWalletsWithoutSeeds(passcode){
			let encryptedWallets = await this.getFromStorage('wallets');

			try{
				let wallets = JSON.parse(await decrypt(encryptedWallets, passcode));

				return wallets.map(wallet => ({...wallet, seed: null}))
			}catch(error){
				throw {message: 'Wrong passcode'}
			}
		}

		async addWallet(wallet, passcode){
			let wallets = [wallet];
			let encryptedWallets = await encrypt(JSON.stringify(wallets), passcode);

			await this.writeToStorage('wallets', encryptedWallets);
		}


		needXRPL(){
			if(this.xrpl.isConnected())
				return

			if(this.xrplPromise)
				return this.xrplPromise

			return this.xrplPromise = this.connectXRPL()
		}

		async connectXRPL(){
			while(true){
				try{
					await this.xrpl.connect();
					break
				}catch{
					await wait(3000);
				}
			}
		}

		async getFromStorage(key){
			return await new Promise(resolve => chrome.storage.local.get(key, data => resolve(data[key])))
		}

		async writeToStorage(key, data){
			return await new Promise(resolve => chrome.storage.local.set({[key]: data}, resolve))
		}

		rescheduleAppStateExpiry(){
			clearTimeout(this.nukeAppStateTimeout);

			this.nukeAppStateTimeout = setTimeout(() => {
				this.appstate = {};
			}, 3 * 60 * 1000);
		}
	}

	/*
	chrome.runtime.onInstalled.addListener(() => {
		chrome.storage.local.set({xid: Math.round(Math.random() * 1000)})
	})

	chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
		console.log("Received %o from %o, frame", msg, sender.tab, sender.frameId, sendResponse);
		chrome.storage.local.get('xid', data => sendResponse(data))
		return true
	});*/

	new Daemon();

})();