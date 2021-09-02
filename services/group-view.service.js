const Sequelize = require('sequelize');
const {
  View,
  RelGroupView,
  RegisteredView,
  DataSetFormat,
  Group,
  DataSet,
} = require('../models');
const Tools = require('../utils/tool');
const { msgError } = require('../utils/messageError');
const { Op } = Sequelize;
const {
  layerData,
  setLegend,
  setFilter,
} = require('../utils/helpers/geoserver/assemblyLayer');

const viewTableName = {
  model: DataSet,
  as: 'dataSet',
  attributes: ['id'],
  include: {
    model: DataSetFormat,
    as: 'dataSetFormat',
    where: { key: { [Op.eq]: 'table_name' } },
    attributes: [['value', 'tableName']],
  },
};

function setTableName(data) {
  try {
    const {
      dataSet: {
        dataSetFormat: [
          {
            dataValues: { tableName },
          },
        ],
      },
    } = data;
    if (tableName) {
      data.dataValues['tableName'] = tableName;
      delete data.dataValues['dataSet'];
    }
  } catch (e) {
    throw new Error(msgError(__filename, 'setTableName', e));
  }
}

async function getModelFields(model) {
  return await model.describe();
}

function removeNullProperties(data) {
  try {
    const filteredData = Object.entries(data).filter(([_, val]) => val);
    return Object.fromEntries(filteredData);
  } catch (e) {
    throw new Error(msgError(__filename, 'removeNullProperties', e));
  }
}

// use at routes?
async function getAll() {
  try {
    const modelFields = Object.keys(await getModelFields(RelGroupView));
    const groupViews = await RelGroupView.findAll({
      attributes: modelFields,
    });
    for (const groupView of groupViews) {
      const id = groupView.viewId;
      groupView.dataValues.view = await View.findByPk(id);
    }
    return await groupViews;
  } catch (e) {
    throw new Error(msgError('group-view.service', 'getAll', e));
  }
}

async function getByGroupId(groupId) {
  try {
    const viewsGroup = [];
    if (groupId) {
      const { code: groupCode } = await Group.findByPk(groupId, { raw: true });
      const where = {
        where: {
          groupId,
        },
        order: [['id', 'ASC']],
      };

      const groupViews = await RelGroupView.findAll({
        ...where,
        attributes: { exclude: ['group_id', 'view_id'] },
        raw: true,
      });
      for (const groupView of groupViews) {
        const { viewId } = groupView;
        let layer = {
          groupCode,
          tools: Tools
        };
        const options = {
          attributes: { exclude: ['id', 'project_id', 'data_series_id'] },
          include: [viewTableName],
        };

        await View.findByPk(viewId, options).then((response) => {
          setTableName(response);
          const filteredResponse = removeNullProperties(response.toJSON());
          Object.assign(layer, filteredResponse);
        });

        const filteredGroupView = removeNullProperties(groupView);
        Object.assign(layer, filteredGroupView);
        if (viewId) {
          const viewName = `view${viewId}`;
          layer.viewName = viewName;
          const registeredData = await RegisteredView.findOne({
            where: {
              view_id: viewId,
            },
            raw: true,
          });
          const { workspace } = registeredData;
          const layerDataOptions = { geoservice: 'wms' };
          layer.layerData = layerData(
            `${workspace}:${viewName}`,
            layerDataOptions,
          );
          layer.legend = setLegend(layer.name, workspace, viewName);
          if (!layer['shortName']) {
            layer.shortName = layer.name;
          }
          if (layer.isPrimary) {
            const layerFilterOptions = { groupCode, viewName };
            const tableOwner = layer.tableName;
            layer.tableOwner = tableOwner;
            const gp = {
              workspace,
              tableOwner,
            };
            layer.filter = setFilter(gp, layerFilterOptions);
          }
        }
        viewsGroup.push(layer);
      }
    }
    if (viewsGroup.length > 2) {
      viewsGroup.forEach((view) => {
        const { isPrimary, subLayers } = view;
        if (isPrimary && subLayers) {
          const sbLayers = [];
          subLayers.forEach((layerId) => {
            sbLayers.push(viewsGroup.find((lyr) => lyr.id == layerId));
          });
          if (sbLayers.length > 0) {
            view.subLayers = sbLayers;
          }
        }
      });
    }
    return viewsGroup.filter((child) => !child.isSublayer);
  } catch (e) {
    throw new Error(msgError('group-view.service', 'getByGroupId', e));
  }
}

async function getAvailableLayers(groupId) {
  try {
    const viewIds = await RelGroupView.findAll({
      where: { groupId },
      attributes: ['viewId'],
    }).then((list) =>
      list.filter(({ viewId }) => viewId).map(({ viewId }) => viewId),
    );

    const option = {
      where: {
        id: { [Op.notIn]: viewIds },
      },
      include: [viewTableName],
    };
    const allViews = await View.findAll(option).then((views) => {
      views.forEach((vw) => {
        setTableName(vw);
      });
      return views.map((view) => view.toJSON());
    });
    return await allViews;
  } catch (e) {
    throw new Error(msgError('group-view.service', 'getAvailableLayers', e));
  }
}

async function add(newGroupView) {
  try {
    const groupView = new RelGroupView({
      groupId: newGroupView.groupId,
      viewId: newGroupView.viewId,
    });
    return await RelGroupView.create(groupView.dataValues).then(
      (groupView) => groupView.dataValues,
    );
  } catch (e) {
    throw new Error(msgError('group-view.service', 'add', e));
  }
}

async function update(groupViewModify) {
  try {
    const { layers, groupId, groupOwner } = groupViewModify;
    if (groupId) {
      await RelGroupView.destroy({ where: { groupId } }).then(async () => {
        const newLayers = layers.map((layer) => ({
          group_id: layer.groupId,
          view_id: layer.viewId,
          ...layer,
        }));
        await RelGroupView.bulkCreate(newLayers);
      });
    }
  } catch (e) {
    throw new Error(msgError('group-view.service', 'update', e));
  }
}

async function updateAdvanced(groupViewModify) {
  try {
    const { editions, groupId } = groupViewModify;
    editions.forEach(async (element) => {
      const { id, ...el } = element;
      const where = { id };
      const newLayerData = { ...el };
      if (element.hasOwnProperty('subLayers') && element.subLayers) {
        newLayerData.subLayers = Array.from(
          new Set(element.subLayers.map(({ id }) => id)),
        );
      }
      await RelGroupView.update(newLayerData, { where });
    });
    return await getByGroupId(groupId);
  } catch (e) {
    throw new Error(msgError(__filename, 'updateAdvanced', e));
  }
}

async function deleteGroupView(id) {
  try {
    await RelGroupView.delete(id);
  } catch (e) {
    throw new Error(msgError('group-view.service', 'delete', e));
  }
}

module.exports = GroupService = {
  getAll,
  getByGroupId,
  getAvailableLayers,
  add,
  update,
  updateAdvanced,
  delete: deleteGroupView,
};
