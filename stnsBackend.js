'use strict';

let aws = require('aws-sdk');
aws.config.update({region: 'ap-northeast-1'});
let dynamo = new aws.DynamoDB.DocumentClient();
let fs = require('fs');

// ユーザ定義テーブル名
const TBL_OSUSER = 'stns-osuser';
// 権限定義テーブル名
const TBL_AUTHORITY = 'stns-authority';

// 標準ユーザグループ名/ID
const DEFUSER_GROUP_NAME = 'operator';
const DEFUSER_GROUP_ID = 10000;
// 管理者ユーザグループ名/ID
const ADMUSER_GROUP_NAME = 'admin';
const ADMUSER_GROUP_ID = 10001;

// setup_commandsにデフォルトで指定するスクリプト
const DEFAULT_SETUP_SCR='.stns-setup.sh';

/**
 * getAllPromise
 *
 * 指定されたDynamoDBのテーブルから全レコード取得して返すPromise関数
 * 'null'文字列のnullリテラルへ置き換えもやります
 *
 * @param  {string} tableName - テーブル名
 * @return {Object} resObj - 指定されたテーブルの全レコード
 */
let getAllPromise = (tableName) => {
  let scanParam = {
    TableName: tableName,
  };
  return new Promise((resolve, reject) => {
    dynamo.scan(scanParam, (err, data) => {
      let resObj = {};
      if (err) {
        console.log(new Error('dynamo.scan error in getAllPromise'));
        reject(err);
        return;
      } else {
        let items = data.Items;
        for (let item of items) {
          for (let field in item) {
            if (item[field] === 'null') item[field] = null;
          }
        }
        // console.log(items);
        resObj[tableName] = items;
      }
      resolve(resObj);
    });
  });
};

/**
 * convArr2Obj
 *
 * 配列からオブジェクトに変換
 * 例）
 * 変換前: [{name: 'hoge', attr1: 'HOGE'}, {name: 'fuga', attr1: 'FUGA'}]
 * 変換後: {hoge: {name: 'hoge', attr1: 'HOGE'}, fuga: {name: 'fuga', attr1: 'FUGA'}}
 *
 * @param  {Object} inObj   - 変換前の配列
 * @param  {string} keyName - オブジェクトのキーにするフィールド名
 * @return {Object} outObj  - 変換後オブジェクト
 */
let convArr2Obj = (inObj, keyName = 'name') => {
  let outObj = {};
  for (let obj of inObj) {
    outObj[obj[keyName]] = obj;
  }
  return outObj;
};

/**
 * getDateTimeStr
 *
 * 年月日時分秒を表す文字列取得
 *
 * @return {string} dateTimeStr - YYYYmmddHHMMSS
 */
let getDateTimeStr = () => {
  // 年月日時分(分は十の位まで)文字列取得
  let date = new Date();
  let YYYY = date.getFullYear();
  let mm = ('0' + (date.getMonth() + 1)).slice(-2);
  let dd = ('0' + (date.getDate())).slice(-2);
  let HH = ('0' + (date.getHours())).slice(-2);
  let MM = ('0' + (date.getMinutes())).slice(-2);
  let SS = ('0' + (date.getSeconds())).slice(-2);
  return `${YYYY}${mm}${dd}${HH}${MM}${SS}`;
};

/**
 * getCache
 *
 * 指定されたキーのキャッシュファイルを確認して存在した場合はその内容(JSON)を返す
 * YYYYmmddHHM という文字列をキー先頭につけることで自動的に10分キャッシュとする
 *
 * @param  {string} key - キャッシュキー
 * @return {Object} cacheObj - キャッシュ(JSON)パースしたオブジェクト(ない場合はnull)
 */
let getCache = (key) => {
  // キャッシュファイルパス(10分ごとに切り替わる)
  let cacheFile = `/tmp/${getDateTimeStr().slice(0, 11)}_${key}`;
  if (fs.existsSync(cacheFile)) {
    return fs.readFileSync(cacheFile, 'utf-8');
  } else {
    return null;
  }
};

/**
 * setCache
 *
 * 指定されたキー／データでキャッシュファイルを作成する
 * YYYYmmddHHM という文字列をキー先頭につけることで自動的に10分キャッシュとする
 *
 * @param  {string} key - キャッシュキー
 * @param  {string} data - キャッシュデータ
 */
let setCache = (key, data) => {
  // キャッシュファイルパス(10分ごとに切り替わる)
  let cacheFile = `/tmp/${getDateTimeStr().slice(0, 11)}_${key}`;
  fs.writeFileSync(cacheFile, data);
};

exports.handler = (event, context, callback) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  let path = event.path;
  // Basic認証ユーザ／パスワード取得（環境／ホスト識別用）
  let env = '';
  let host = '';
  let authStr = event.headers.Authorization;
  if (authStr) {
    console.log('found Authorization Header');
    let b64Encoded = authStr.replace(/Basic /, '');
    let b64Decoded = Buffer.from(b64Encoded, 'base64').toString();
    env = b64Decoded.split(':')[0];
    host = b64Decoded.split(':')[1];
  }
  console.log(`path: ${path}, env: ${env}, host: ${host}`);

  const done = (err, res) => {
    let resObj = {
      statusCode: err ? '404' : '200',
      body: err ? '{"Error":"' + err.message + '"}' : JSON.stringify(res, null, 2),
    };
    console.log(JSON.stringify(resObj, null, 2));
    callback(null, resObj);
  };

  if (event.httpMethod !== 'GET') {
    done(new Error(`Unsupported method: ${event.httpMethod}`));
    return;
  } else if (path === '/healthcheck') {
    done(null, {success: 'true'});
    return;
  }

  let resObj = {};
  let osUserList = [];
  let authorityList = [];
  // 並列でDynamoDBからデータ取得するPromise関数配列を作成
  let promiseArray = [];
  if (path.indexOf('/user/') === 0 || path.indexOf('/group/') === 0) {
    // DynamoDBからユーザ情報取得
    let userCacheKey = `${env}_user`;
    let userCacheData = getCache(userCacheKey);
    if (userCacheData) {
      console.log(`cache hit : ${userCacheKey}`);
      osUserList = JSON.parse(userCacheData);
    } else {
      console.log(`cache miss: ${userCacheKey}`);
      promiseArray.push(getAllPromise(TBL_OSUSER));
    }
    // DynamoDBから権限情報取得
    let authCacheKey = `${env}_group`;
    let authCacheData = getCache(authCacheKey);
    if (authCacheData) {
      console.log(`cache hit : ${authCacheKey}`);
      authorityList = JSON.parse(authCacheData);
    } else {
      console.log(`cache miss: ${authCacheKey}`);
      promiseArray.push(getAllPromise(TBL_AUTHORITY));
    }
  }

  // DynamoDBから必要なデータ取得を並列に実行
  Promise.all(promiseArray)
    .then((resultArray) => {
      for (let tableData of resultArray) {
        for (let tableName in tableData) {
          if (tableData.hasOwnProperty(tableName)) {
            if (tableName === TBL_OSUSER) {
              osUserList = tableData[tableName];
              // キャッシュ保存
              let cacheKey = `${env}_user`;
              setCache(cacheKey, JSON.stringify(osUserList, null, 2));
            }
            if (tableName === TBL_AUTHORITY) {
              authorityList = tableData[tableName];
              // キャッシュ保存
              let cacheKey = `${env}_group`;
              setCache(cacheKey, JSON.stringify(authorityList, null, 2));
            }
          }
        }
      }

      // 扱い易さのために、DynamoDB(or キャッシュ)から取得したデータを
      // itemの配列から、nameをキーとしたオブジェクトに変換
      let osUserData = convArr2Obj(osUserList);
      let authorityData = convArr2Obj(authorityList);

      // ユーザ情報を取得しレスポンス用に整形する
      if (path.indexOf('/user/') === 0) {
        let linkUserHash = {};
        for (let key in osUserData) {
          if (! osUserData.hasOwnProperty(key)) continue;
          let user = osUserData[key];
          let name = user.name;
          let keys = [];
          if (user.keys) keys = keys.concat(user.keys.split(','));
          if (user.link_users) linkUserHash[name] = user.link_users.split(',');

          resObj[name] = {
            id: parseInt(user.id),
            password: user.password || '',
            group_id: user.group_id || DEFUSER_GROUP_ID,
            directory: user.directory || `/home/${name}`,
            shell: user.shell || '/bin/bash',
            gecos: user.gecos || '',
            keys: keys,
            link_users: user.link_users ? user.link_users.split(',') : null,
            setup_commands: null,
          };

          // stns-setupコマンドで実行する文字列生成
          // まずはstns-setupコマンドに渡す変数の組み立て
          let setupCommands = [];
          let setupVariables = '';
          if (user.setup_variables) {
            try {
              let varsJson = JSON.parse(user.setup_variables);
              for (let variable in varsJson) {
                if (varsJson.hasOwnProperty(variable)) {
                  setupVariables += ` ${variable}=${varsJson[variable]}`;
                }
              }
            } catch (e) {
              console.log(`json parse error: ${e}`);
            }
          }
          // user.setup_commandsにデフォルトのスクリプトを指定
          setupCommands.push(`env${setupVariables} /bin/sh ${resObj[name].directory}/${DEFAULT_SETUP_SCR}`);
          // setupCommands(配列型JSON)の各コマンドにsetupVariables(環境変数)を渡して実行
          if (user.setup_commands) {
            try {
              let cmdsJson = JSON.parse(user.setup_commands);
              for (let j; j < cmdsJson.length; j++) {
                setupCommands.push(`env${setupVariables} ${cmdsJson[j]}`);
              }
            } catch (e) {
              console.log(`json parse error: ${e}`);
            }
          }
          resObj[name].setup_commands = setupCommands;
        }

        // link_usersで紐づいたkeyを配列末尾に追加
        for (let name in linkUserHash) {
          if (linkUserHash.hasOwnProperty(name)) {
            for (let i = 0; i < linkUserHash[name].length; i++) {
              resObj[name]['keys'] = resObj[name]['keys'].concat(resObj[linkUserHash[name][i]].keys);
            }
          }
        }

        if (path === '/user/list') {
          done(null, resObj);
          return;
        } else if (/\/user\/name\/[^/]+$/.test(path)) {
          let userName = path.split('/').pop();
          if (resObj[userName]) {
            done(null, {[userName]: resObj[userName]});
            return;
          }
        } else if (/\/user\/id\/[0-9]+$/.test(path)) {
          let userId = parseInt(path.split('/').pop());
          for (let name in resObj) {
            if (resObj[name].id === userId) {
              done(null, {[name]: resObj[name]});
              return;
            }
          }
        }
      // 権限情報を取得しレスポンス用に整形する
      } else if (path.indexOf('/group/') === 0) {
        // 標準グループ用レスポンス
        resObj[DEFUSER_GROUP_NAME] = {
          id: DEFUSER_GROUP_ID,
          users: [],
          link_groups: null,
        };

        for (let key in osUserData) {
          if (! osUserData.hasOwnProperty(key)) continue;
          resObj[DEFUSER_GROUP_NAME]['users'].push(osUserData[key].name);
        }

        // 管理者グループ用レスポンス
        let defaultAuthoriy = {
          id: ADMUSER_GROUP_ID,
        };
        for (let i = 0; i < authorityList.length; i++) {
          let authority = authorityList[i];
          let name = authority.name;
          if (env === name) {
            resObj[ADMUSER_GROUP_NAME] = {
              id: ADMUSER_GROUP_ID,
              users: authority.superusers.split(','),
              link_groups: null,
            };
          }
          if (name === 'default') {
            defaultAuthoriy['users'] = authority.superusers.split(',');
            defaultAuthoriy['link_groups'] = null;
          }
        }
        // 当該環境の管理者グループ定義が指定なしの場合はdefaultを使う
        if (! resObj[ADMUSER_GROUP_NAME]) resObj[ADMUSER_GROUP_NAME] = defaultAuthoriy;

        if (path === '/group/list') {
          done(null, resObj);
          return;
        } else if (/\/group\/name\/[0-9]+$/.test(path)) {
          let groupName = path.split('/').pop();
          if (resObj[groupName]) {
            done(null, {[groupName]: resObj[groupName]});
            return;
          }
        } else if (/\/group\/id\/[0-9]+$/.test(path)) {
          let groupId = parseInt(path.split('/').pop());
          for (let name in resObj) {
            if (resObj[name].id === groupId) {
              done(null, {[name]: resObj[name]});
              return;
            }
          }
        }
      }
      done(new Error(`Resource not found: ${path}`));
    })
    .catch((err) => {
      console.log(err, err.stack);
      done(err);
    });
};

