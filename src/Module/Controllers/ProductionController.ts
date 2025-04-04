import model from '@src/Data/Model';
import * as angular from 'angular';
import {ILocationService, IScope, ITimeoutService} from 'angular';
import {ProductionTab} from '@src/Tools/Production/ProductionTab';
import {IItemSchema} from '@src/Schema/IItemSchema';
import {Constants} from '@src/Constants';
import data, {Data} from '@src/Data/Data';
import {IRecipeSchema} from '@src/Schema/IRecipeSchema';
import {IResourceSchema} from '@src/Schema/IResourceSchema';
import {DataStorageService} from '@src/Module/Services/DataStorageService';
import axios from 'axios';
import {IProductionData} from '@src/Tools/Production/IProductionData';
import {IBuildingSchema} from '@src/Schema/IBuildingSchema';
import {FileExporter} from '@src/Export/FileExporter';
import {Strings} from '@src/Utils/Strings';
import {IRootScope} from '@src/Types/IRootScope';

export class ProductionController
{
	public static $inject = ['$scope', '$timeout', 'DataStorageService', '$location', '$rootScope'];

	public selectedTabs: ProductionTab[] = [];
	public tab: ProductionTab|null = null;
	public tabs: ProductionTab[] = [];
	public addingInProgress: boolean;
	public cloningInProgress: boolean;
	public importOpen: boolean = false;
	public importFiles: File[] = [];
	public lastSaveTime: Date | null = null;
	public saveInProgress: boolean = false;
	public autoSaveEnabled: boolean = true; // Default to enabled
	public saveDelaySeconds: number = 60; // Default to 60 seconds (1 minute)
	public readonly rawResources: IResourceSchema[] = data.getResources();
	public readonly craftableItems: IItemSchema[] = model.getAutomatableItems();
	public readonly inputableItems: IItemSchema[] = model.getInputableItems();
	public readonly sinkableItems: IItemSchema[] = data.getSinkableItems();
	public readonly alternateRecipes: IRecipeSchema[] = data.getAlternateRecipes();
	public readonly basicRecipes: IRecipeSchema[] = data.getBaseItemRecipes();
	public readonly machines: IBuildingSchema[] = data.getManufacturers();
	public result: string;
	public options: {} = {
		'items/min': Constants.PRODUCTION_TYPE.PER_MINUTE,
		'maximize': Constants.PRODUCTION_TYPE.MAXIMIZE,
	};

	private saveDebounceTimeout: any = null;
	private readonly storageKey: string;

	public constructor(
		private readonly scope: IProductionControllerScope,
		private readonly $timeout: ITimeoutService,
		private readonly dataStorageService: DataStorageService,
		private readonly $location: ILocationService,
		private readonly $rootScope: IRootScope,
	)
	{
		if ($rootScope.version === '1.0') {
			this.storageKey = 'production1';
		} else if ($rootScope.version === '1.0-ficsmas') {
			this.storageKey = 'production-ficsmas';
		} else {
			this.storageKey = 'tmpProduction';
		}

		// Load auto-save settings
		const savedSettings = this.dataStorageService.loadData('autoSaveSettings', null);
		if (savedSettings) {
			this.autoSaveEnabled = savedSettings.enabled;
			this.saveDelaySeconds = savedSettings.delay;
		}

		scope.$timeout = $timeout;
		scope.saveState = () => {
			this.saveState();
			this.debouncedSaveToServer();
		};

		// Load state from server first, fallback to local storage if needed
		this.loadStateWithServerFallback();
		$timeout(() => {
			const query = this.$location.search();
			if ('share' in query) {
				axios({
					method: 'GET',
					url: 'https://api.satisfactorytools.com/v2/share/' + encodeURIComponent(query.share),
				}).then((response) => {
					$timeout(0).then(() => {
						const tabData: IProductionData = response.data.data;
						tabData.metadata.name = 'Shared: ' + tabData.metadata.name;
						const tab = new ProductionTab(this.scope, $rootScope.version, tabData);
						tab.controller = this; // Add reference to controller for auto-save
						this.tabs.push(tab);
						this.tab = tab;
						this.saveState();
						this.$location.search('');
					});
				}).catch(() => {
					this.$location.search('');
				});
			}
		});
	}

	/**
	 * Debounces save operations to avoid excessive server requests
	 */
	public debouncedSaveToServer(): void {
		// Skip if auto-save is disabled
		if (!this.autoSaveEnabled) {
			return;
		}

		// Clear any existing timeout
		if (this.saveDebounceTimeout) {
			this.$timeout.cancel(this.saveDebounceTimeout);
		}
		
		// Set a new timeout
		this.saveDebounceTimeout = this.$timeout(() => {
			this.performServerSave();
		}, this.saveDelaySeconds * 1000); // Convert to milliseconds
	}

	/**
	 * Updates the auto-save settings and saves them to localStorage
	 */
	public updateAutoSaveSettings(): void {
		// Save settings to localStorage
		this.dataStorageService.saveData('autoSaveSettings', {
			enabled: this.autoSaveEnabled,
			delay: this.saveDelaySeconds
		});

		// If turning off auto-save, cancel any pending save
		if (!this.autoSaveEnabled && this.saveDebounceTimeout) {
			this.$timeout.cancel(this.saveDebounceTimeout);
		}
	}

	public toggleImport(): void
	{
		this.importOpen = !this.importOpen;
	}

	public tryImport(): void
	{
		const input: HTMLInputElement = document.getElementById('importFile') as HTMLInputElement;
		const files = input.files as FileList;

		if (files.length === 0) {
			return;
		}

		const file = files[0];
		const reader = new FileReader();
		reader.readAsText(file, 'utf-8');
		reader.onload = () => {
			try {
				const tabs = FileExporter.importTabs(reader.result as string);

				for (const tab of tabs) {
					if (JSON.stringify(tab.request.resourceMax) === JSON.stringify(Data.resourceAmountsU8)) {
						tab.request.resourceMax = Data.resourceAmounts;
					}

					if (typeof tab.request.resourceMax.Desc_SAM_C === 'undefined') {
						tab.request.resourceMax.Desc_SAM_C = 0;
					}

					tab.request.resourceWeight = Data.resourceWeights;
					const productionTab = new ProductionTab(this.scope, this.$rootScope.version, tab);
					productionTab.controller = this; // Add reference to controller for auto-save
					this.tabs.push(productionTab);
				}

				Strings.addNotification('Import complete', 'Successfuly imported ' + tabs.length + ' tab' + (tabs.length === 1 ? '' : 's') + '.');
				// Use $timeout to safely update UI instead of $apply
				this.$timeout(() => {
					// UI will be updated safely in the next digest cycle
				});
				input.value = '';
			} catch (e) {
				Strings.addNotification('ERROR', 'Couldn\'t import file: ' + e.message, 5000);
				return;
			}
		}
	}

	public selectAllTabs(): void
	{
		this.selectedTabs = [];
		for (const tab of this.tabs) {
			this.selectedTabs.push(tab);
		}
	}

	public toggleTab(tab: ProductionTab): void
	{
		const index = this.selectedTabs.indexOf(tab);
		if (index === -1) {
			this.selectedTabs.push(tab);
		} else {
			this.selectedTabs.splice(index, 1);
		}
	}

	public isTabSelected(tab: ProductionTab): boolean
	{
		return this.selectedTabs.indexOf(tab) !== -1;
	}

	public removeSelectedTabs(): void
	{
		if (this.selectedTabs.length === 0) {
			return;
		}
		if (confirm('Do you really want to remove ' + this.selectedTabs.length + ' tab' + (this.selectedTabs.length > 1 ? 's?' : '?'))) {
			for (const tab of this.selectedTabs) {
				this.removeTab(tab);
			}
			this.selectedTabs = [];
		}
	}

	public exportSelectedTabs(): void
	{
		if (this.selectedTabs.length === 0) {
			return;
		}
		Strings.downloadFile('sftools-export-' + Strings.dateToIso(new Date()) + '.sft', FileExporter.exportTabs(this.selectedTabs));
	}

	public addEmptyTab(): void
	{
		this.addingInProgress = true;
		this.$timeout(0).then(() => {
			const tab = new ProductionTab(this.scope, this.$rootScope.version);
			tab.controller = this; // Add reference to controller for auto-save
			this.tabs.push(tab);
			this.tab = tab;
			this.addingInProgress = false;
		});
		this.saveState();
		this.debouncedSaveToServer();
	}

	public cloneTab(tab: ProductionTab): void
	{
		this.cloningInProgress = true;
		this.$timeout(0).then(() => {
			const clone = new ProductionTab(this.scope, this.$rootScope.version);
			clone.data.request = angular.copy(tab.data.request);
			clone.data.metadata.name = 'Clone: ' + clone.data.metadata.name;
			clone.controller = this; // Add reference to controller for auto-save
			this.tabs.push(clone);
			this.tab = clone;
			this.cloningInProgress = false;
		});
		this.saveState();
		this.debouncedSaveToServer();
	}

	public removeTab(tab: ProductionTab): void
	{
		const index = this.tabs.indexOf(tab);
		if (index !== -1) {
			if (tab === this.tab) {
				let newIndex = index - 1;
				if (newIndex < 0) {
					newIndex = index + 1;
				}
				this.tab = newIndex in this.tabs ? this.tabs[newIndex] : null;
			}

			tab.unregister();
			this.tabs.splice(index, 1);
			if (this.tabs.length === 0) {
				this.addEmptyTab();
			}
		}
		this.saveState();
		this.debouncedSaveToServer();
	}

	public clearAllTabs(): void
	{
		this.tabs.forEach((tab: ProductionTab, index: number) => {
			tab.unregister();
		});
		this.tabs = [];
		this.addEmptyTab();
		this.debouncedSaveToServer();
	}

	public getItem(className: string): IItemSchema
	{
		return model.getItem(className).prototype;
	}

	public getBuilding(className: string): IBuildingSchema|null
	{
		return data.getRawData().buildings[className];
	}

	public getRecipe(className: string): IRecipeSchema|null
	{
		return data.getRawData().recipes[className];
	}

	public saveToServer(): void 
	{
		const save: IProductionData[] = [];
		for (const tab of this.tabs) {
			save.push(tab.data);
		}
		
		try {
			const savePromise = this.dataStorageService.saveToServer(this.storageKey, save);
			
			Strings.addNotification('Info', 'Saving to server...', 1500);
			
			savePromise.then(() => {
				// Only show success if we get here (the promise resolved successfully)
				Strings.addNotification('Success', 'Production data saved to server.', 3000);
				this.lastSaveTime = new Date();
				
				// Also save to localStorage to keep them in sync
				this.saveState();
			})
			.catch((error) => {
				console.error('Server save failed:', error);
				Strings.addNotification('Error', 'Failed to save data to server. Check console for details.', 5000);
			});
		} catch (error) {
			console.error('Error initiating save operation:', error);
			Strings.addNotification('Error', 'Failed to initiate server save operation.', 5000);
		}
	}

	public loadFromServer(): void 
	{
		try {
			Strings.addNotification('Info', 'Loading from server...', 1500);
			
			this.dataStorageService.loadFromServer(this.storageKey, null)
				.then((loaded) => {
					if (loaded === null) {
						Strings.addNotification('Info', 'No production data found on server.', 3000);
						return;
					}
					
					// Use $timeout to safely queue UI updates outside of current digest cycle
					this.$timeout(() => {
						// Clear existing tabs
						this.tabs.forEach((tab: ProductionTab) => {
							tab.unregister();
						});
						this.tabs = [];
						
						// Load new tabs from server
						for (const item of loaded) {
							const tab = new ProductionTab(this.scope, this.$rootScope.version, item);
							tab.controller = this; // Add reference to controller for auto-save
							this.tabs.push(tab);
						}
						
						if (this.tabs.length) {
							this.tab = this.tabs[0];
							Strings.addNotification('Success', `Loaded ${this.tabs.length} production ${this.tabs.length === 1 ? 'tab' : 'tabs'} from server.`, 3000);
						} else {
							this.addEmptyTab();
							Strings.addNotification('Warning', 'Server data was loaded but contained no production tabs.', 3000);
						}
						
						// Save to localStorage to keep them in sync
						this.saveState();
					});
				})
				.catch((error) => {
					console.error('Server load failed:', error);
					Strings.addNotification('Error', 'Failed to load data from server. Check console for details.', 5000);
				});
		} catch (error) {
			console.error('Error initiating load operation:', error);
			Strings.addNotification('Error', 'Failed to initiate server load operation.', 5000);
		}
	}

	/**
	 * Performs the actual save operation to the server
	 */
	private performServerSave(): void {
		// Skip if a save is already in progress
		if (this.saveInProgress) {
			return;
		}

		this.saveInProgress = true;

		const save: IProductionData[] = [];
		for (const tab of this.tabs) {
			save.push(tab.data);
		}

		// Subtle notification
		Strings.addNotification('Info', 'Saving to server...', 1000);

		this.dataStorageService.saveToServer(this.storageKey, save)
			.then(() => {
				this.lastSaveTime = new Date();
				// Keep local storage in sync
				this.saveState();
				// Subtle success indication
				Strings.addNotification('Success', 'Saved to server', 1000);
			})
			.catch((error) => {
				console.error('Server save failed:', error);
				Strings.addNotification('Error', 'Failed to save to server', 3000);
			})
			.finally(() => {
				this.saveInProgress = false;
			});
	}

	/**
	 * Loads state with server data as primary source, local storage as fallback
	 */
	private loadStateWithServerFallback(): void {
		Strings.addNotification('Info', 'Loading from server...', 1000);

		this.dataStorageService.loadFromServer(this.storageKey, null)
			.then((loaded) => {
				if (loaded === null) {
					// No server data, fall back to local
					Strings.addNotification('Info', 'No data found on server, using local data', 2000);
					this.loadLocalState();
				} else {
					this.$timeout(() => {
					// Clear existing tabs
					this.tabs.forEach((tab: ProductionTab) => {
						tab.unregister();
					});
					this.tabs = [];

					// Load new tabs from server
					for (const item of loaded) {
						const tab = new ProductionTab(this.scope, this.$rootScope.version, item);
						tab.controller = this; // Add reference to controller for auto-save
						this.tabs.push(tab);
					}

					if (this.tabs.length) {
						this.tab = this.tabs[0];
						Strings.addNotification('Success', `Loaded ${this.tabs.length} production ${this.tabs.length === 1 ? 'tab' : 'tabs'} from server`, 2000);
					} else {
						this.addEmptyTab();
						Strings.addNotification('Warning', 'Server data was loaded but contained no production tabs', 3000);
					}

					// Save to localStorage to keep them in sync
					this.saveState();
					});
				}
			})
			.catch((error) => {
				console.error('Server load failed:', error);
				// Fall back to local storage
				Strings.addNotification('Info', 'Using local data (server unavailable)', 3000);
				this.loadLocalState();
			});
	}

	private loadLocalState(): void {
		const loaded = this.dataStorageService.loadData(this.storageKey, null);
		if (loaded === null) {
			this.addEmptyTab();
		} else {
			for (const item of loaded) {
				const tab = new ProductionTab(this.scope, this.$rootScope.version, item);
				tab.controller = this; // Add reference to controller for auto-save
				this.tabs.push(tab);
			}
			if (this.tabs.length) {
				this.tab = this.tabs[0];
			} else {
				this.addEmptyTab();
			}
		}
		
		// Check if there's any meaningful content in the tabs to enable the load from server button
		this.$timeout(() => {
		const hasData = this.tabs.some(tab => 
			tab.data.request.production.length > 0 || 
			tab.data.request.input.length > 0);

			if (!hasData) {
				// If no meaningful data in local storage, try loading from server
				this.loadFromServer();
			}
		});
	}

	private loadState(): void
	{
		const loaded = this.dataStorageService.loadData(this.storageKey, null);
		if (loaded === null) {
			this.addEmptyTab();
		} else {
			for (const item of loaded) {
				this.tabs.push(new ProductionTab(this.scope, this.$rootScope.version, item));
			}
			if (this.tabs.length) {
				this.tab = this.tabs[0];
			} else {
				this.addEmptyTab();
			}
		}
	}

	private saveState(): void
	{
		const save: IProductionData[] = [];
		for (const tab of this.tabs) {
			save.push(tab.data);
		}
		this.dataStorageService.saveData(this.storageKey, save);
	}
}

export interface IProductionControllerScope extends IScope
{
	$timeout: ITimeoutService;
	saveState: () => void;
}
