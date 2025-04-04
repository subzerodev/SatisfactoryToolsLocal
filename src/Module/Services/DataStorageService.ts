import angular, {IHttpService, IQService, IPromise, IWindowService} from 'angular';

export class DataStorageService
{

	public static $inject = ['$window', '$http', '$q'];

	public constructor(
		private readonly $window: IWindowService,
		private readonly $http: IHttpService,
		private readonly $q: IQService
	) {}

	public saveData(key: string, data: any)
	{
		this.$window.localStorage.setItem(key, angular.toJson(data));
	}

	public loadData(key: string, def: any)
	{
		const item = this.$window.localStorage.getItem(key);
		return item === null ? def : angular.fromJson(item);
	}

	public saveToServer(key: string, data: any): IPromise<void>
	{
		return this.$http.post(`/api/storage.php?key=${encodeURIComponent(key)}`, data)
			.then((response: any) => {
				if (!response || !response.data || !response.data.success) {
					console.error('Server returned unsuccessful response:', response);
					return this.$q.reject('Save operation did not return success response');
				}
				return void 0;
			})
			.catch((error: Error) => {
				console.error('Failed to save data to server:', error);
				return this.$q.reject(error);
			});
	}

	public loadFromServer(key: string, def: any): IPromise<any>
	{
		return this.$http.get(`/api/storage.php?key=${encodeURIComponent(key)}`)
			.then((response: any) => {
				// Handle null response
				if (!response || !response.data || response.data === 'null') {
					// No data found on server for key
					return def;
				}
				return response.data;
			})
			.catch((error: Error) => {
				console.error('Failed to load data from server:', error);
				return this.$q.reject(error);
			});
	}
}
