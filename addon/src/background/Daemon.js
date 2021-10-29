import xrpl from '../lib/xrpl.js'
import { wait } from '../utils/time.js'
import { encrypt, decrypt } from '../utils/crypto.js'

const defaultXRPLNode = 'wss://s1.ripple.com'

export default class{
	constructor(){
		this.pstates = {}
		this.xrpl = new xrpl.Client(defaultXRPLNode)

		chrome.runtime.onMessage.addListener(this.handleMessage.bind(this))
	}

	handleMessage(message, sender, reply){
		this.serveRequest(message)
			.then(payload => reply({success: true, payload}))
			.catch(error => reply({success: false, error: {message: error.message}}))

		return true
	}

	async serveRequest(payload){
		switch(payload.type){
			case 'has-wallets':
				return !!await this.getFromStorage('wallets')

			case 'get-wallets':
				return await this.getUnlockedWalletsWithoutSeeds(payload.passcode)

			case 'add-wallet':
				await this.addWallet(payload.wallet, payload.passcode)
				break

			case 'get-appstate':
				return this.appstate

			case 'set-appstate':
				this.appstate = payload.state
				this.rescheduleAppStateExpiry()
				break

			case 'derive-address':
				return xrpl.Wallet.fromSeed(payload.seed).address

			case 'get-xrp-balance':
				await this.needXRPL()

				try{
					return await this.xrpl.getXrpBalance(payload.address)
				}catch{
					return NaN
				}

			case 'get-balances':
				await this.needXRPL()

				return await this.xrpl.getBalances(payload.address)

		}
	}

	async getUnlockedWalletsWithoutSeeds(passcode){
		let encryptedWallets = await this.getFromStorage('wallets')

		try{
			let wallets = JSON.parse(await decrypt(encryptedWallets, passcode))

			return wallets.map(wallet => ({...wallet, seed: null}))
		}catch(error){
			throw {message: 'Wrong passcode'}
		}
	}

	async addWallet(wallet, passcode){
		let wallets = [wallet]
		let encryptedWallets = await encrypt(JSON.stringify(wallets), passcode)

		await this.writeToStorage('wallets', encryptedWallets)
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
				await this.xrpl.connect()
				break
			}catch{
				await wait(3000)
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
		clearTimeout(this.nukeAppStateTimeout)

		this.nukeAppStateTimeout = setTimeout(() => {
			this.appstate = {}
		}, 3 * 60 * 1000)
	}
}